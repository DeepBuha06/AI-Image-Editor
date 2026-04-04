import { NextResponse } from "next/server";
import {
    getResultImage,
    submitWorkflow,
    uploadImage,
    waitForResult,
} from "../../../lib/comfyui";

// ─── Intent Parser ────────────────────────────────────────────────────────────

function parseEditIntent(editPrompt) {
    const lower = editPrompt.toLowerCase();
    if (/remove|delete|erase|eliminate|get rid of|clean up/.test(lower)) return "remove";
    if (/add|place|put|insert|include/.test(lower))                       return "add";
    if (/replace|change|swap|turn|make it/.test(lower))                   return "replace";
    return "edit";
}

/**
 * Converts natural-language instructions into proper SD prompts.
 *
 * "Remove the people from the image"
 *   → positive: "empty street, natural background, no people, seamless..."
 *   → negative: "person, people, human, ..."
 *
 * "Place a bicycle near the tree"
 *   → positive: "a bicycle parked near the tree, naturally integrated..."
 */
function buildPromptPair(editPrompt, intent) {
    const baseNeg = "blurry, duplicate, deformed, ugly, bad anatomy, bad lighting, artifacts, watermark, seam, border";

    switch (intent) {
        case "remove": {
            // Strip action words to extract the subject ("the people", "the car", etc.)
            const subject = editPrompt
                .replace(/remove|delete|erase|eliminate|get rid of|clean up/gi, "")
                .replace(/\b(from|in|the|a|an|this|image|photo|picture)\b/gi, "")
                .trim();

            return {
                positive: `seamless background, natural scene, empty space where ${subject} was, ` +
                          `clean continuation of surroundings, high quality, photorealistic`,
                negative: `${subject}, ${baseNeg}`,
            };
        }

        case "add": {
            // Keep the instruction but reframe it as a scene description
            const subject = editPrompt
                .replace(/add|place|put|insert|include/gi, "")
                .replace(/\b(a|an)\b/gi, "")
                .trim();

            return {
                positive: `${subject}, naturally integrated into scene, consistent lighting and shadows, ` +
                          `photorealistic, high quality, detailed`,
                negative: baseNeg,
            };
        }

        case "replace": {
            return {
                positive: `${editPrompt}, seamlessly blended, consistent lighting, high quality, photorealistic`,
                negative: baseNeg,
            };
        }

        default:
            return {
                positive: `${editPrompt}, high quality, detailed, photorealistic`,
                negative: baseNeg,
            };
    }
}

// ─── Shared sampler config by intent ─────────────────────────────────────────

function getSamplerConfig(intent) {
    return {
        // ComfyUI expects canonical sampler IDs (e.g. dpmpp_2m), not UI-style labels.
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        steps: 30,
        cfg: intent === "remove" ? 7.0 : 7.5,   // lower cfg → less over-saturation on fills
        denoise: intent === "remove" ? 1.0        // full redraw for clean removal
               : intent === "add"    ? 0.85       // mostly redraw but respect surroundings
               : 0.9,
        grow_mask_by: intent === "remove" ? 14 : 8,  // wider feather prevents hard edges on removal
    };
}

// ─── Workflow 1: GroundingDINO + SAM2 (auto-segment by text) ─────────────────

function buildGroundingDinoWorkflow(imageName, targetObject, editPrompt, editStrength) {
    const intent = parseEditIntent(editPrompt);
    const { positive, negative } = buildPromptPair(editPrompt, intent);
    const cfg = getSamplerConfig(intent);
    if (editStrength !== undefined) cfg.denoise = editStrength; // allow manual override

    return {
        // ── Loaders ──────────────────────────────────────────────────────────
        "1": { class_type: "LoadImage",
               inputs: { image: imageName } },

        "2": { class_type: "CheckpointLoaderSimple",
               inputs: { ckpt_name: "sd-v1-5-inpainting.ckpt" } },

        // ── Prompts ───────────────────────────────────────────────────────────
        "3": { class_type: "CLIPTextEncode",
               inputs: { text: positive, clip: ["2", 1] } },

        "4": { class_type: "CLIPTextEncode",
               inputs: { text: negative, clip: ["2", 1] } },

        // ── Segmentation (GroundingDINO → SAM2) ──────────────────────────────
        "5": { class_type: "SAM2ModelLoader (segment anything2)",
               inputs: { model_name: "sam2_1_hiera_base_plus.pt" } },

        "6": { class_type: "GroundingDinoModelLoader (segment anything2)",
               inputs: { model_name: "GroundingDINO_SwinT_OGC (694MB)" } },

        "7": {
            class_type: "GroundingDinoSAM2Segment (segment anything2)",
            inputs: {
                sam_model: ["5", 0],
                grounding_dino_model: ["6", 0],
                image: ["1", 0],
                prompt: targetObject,
                threshold: 0.3,
                keep_model_loaded: false,
            },
        },

        // ── Mask feathering — softer edge for natural blending ────────────────
        "8": { class_type: "GrowMask",
               inputs: { mask: ["7", 1], expand: cfg.grow_mask_by, tapered_corners: true } },

        // ── Encode for inpainting ─────────────────────────────────────────────
        "9": {
            class_type: "VAEEncodeForInpaint",
            inputs: { pixels: ["1", 0], vae: ["2", 2], mask: ["8", 0], grow_mask_by: 0 },
        },

        // ── First pass: main inpaint ──────────────────────────────────────────
        "10": {
            class_type: "KSampler",
            inputs: {
                model: ["2", 0],
                positive: ["3", 0],
                negative: ["4", 0],
                latent_image: ["9", 0],
                seed: Math.floor(Math.random() * 1_000_000_000),
                steps: cfg.steps,
                cfg: cfg.cfg,
                sampler_name: cfg.sampler_name,
                scheduler: cfg.scheduler,
                denoise: cfg.denoise,
            },
        },

        // ── Decode first pass ─────────────────────────────────────────────────
        "11": { class_type: "VAEDecode",
                inputs: { samples: ["10", 0], vae: ["2", 2] } },

        // ── Composite first-pass result onto original ─────────────────────────
        "12": {
            class_type: "ImageCompositeMasked",
            inputs: { destination: ["1", 0], source: ["11", 0], mask: ["8", 0],
                      x: 0, y: 0, resize_source: false },
        },

        // ── Second pass: low-denoise refinement for seamless blending ─────────
        "13": {
            class_type: "VAEEncodeForInpaint",
            inputs: { pixels: ["12", 0], vae: ["2", 2], mask: ["8", 0], grow_mask_by: 0 },
        },

        "14": {
            class_type: "KSampler",
            inputs: {
                model: ["2", 0],
                positive: ["3", 0],
                negative: ["4", 0],
                latent_image: ["13", 0],
                seed: Math.floor(Math.random() * 1_000_000_000),
                steps: 20,
                cfg: 5.0,              // low cfg on refinement pass = subtle, no over-cooking
                sampler_name: cfg.sampler_name,
                scheduler: cfg.scheduler,
                denoise: 0.3,          // only 30% redraw to smooth boundaries
            },
        },

        "15": { class_type: "VAEDecode",
                inputs: { samples: ["14", 0], vae: ["2", 2] } },

        // ── Final composite ───────────────────────────────────────────────────
        "16": {
            class_type: "ImageCompositeMasked",
            inputs: { destination: ["12", 0], source: ["15", 0], mask: ["8", 0],
                      x: 0, y: 0, resize_source: false },
        },

        "17": { class_type: "SaveImage",
                inputs: { images: ["16", 0], filename_prefix: "pixxel_final" } },
    };
}

// ─── Workflow 2: Manual brush mask ───────────────────────────────────────────

function buildManualBrushWorkflow(imageName, maskName, editPrompt, editStrength) {
    const intent = parseEditIntent(editPrompt);
    const { positive, negative } = buildPromptPair(editPrompt, intent);
    const cfg = getSamplerConfig(intent);
    if (editStrength !== undefined) cfg.denoise = editStrength;

    return {
        // ── Loaders ──────────────────────────────────────────────────────────
        "1": { class_type: "LoadImage",
               inputs: { image: imageName } },

        "2": { class_type: "LoadImage",
               inputs: { image: maskName } },

        "3": { class_type: "ImageToMask",
               inputs: { image: ["2", 0], channel: "red" } },

        "4": { class_type: "CheckpointLoaderSimple",
               inputs: { ckpt_name: "sd-v1-5-inpainting.ckpt" } },

        // ── Prompts ───────────────────────────────────────────────────────────
        "5": { class_type: "CLIPTextEncode",
               inputs: { text: positive, clip: ["4", 1] } },

        "6": { class_type: "CLIPTextEncode",
               inputs: { text: negative, clip: ["4", 1] } },

        // ── Mask feathering ───────────────────────────────────────────────────
        "7": { class_type: "GrowMask",
               inputs: { mask: ["3", 0], expand: cfg.grow_mask_by, tapered_corners: true } },

        // ── Encode for inpainting ─────────────────────────────────────────────
        "8": {
            class_type: "VAEEncodeForInpaint",
            inputs: { pixels: ["1", 0], vae: ["4", 2], mask: ["7", 0], grow_mask_by: 0 },
        },

        // ── First pass ────────────────────────────────────────────────────────
        "9": {
            class_type: "KSampler",
            inputs: {
                model: ["4", 0],
                positive: ["5", 0],
                negative: ["6", 0],
                latent_image: ["8", 0],
                seed: Math.floor(Math.random() * 1_000_000_000),
                steps: cfg.steps,
                cfg: cfg.cfg,
                sampler_name: cfg.sampler_name,
                scheduler: cfg.scheduler,
                denoise: cfg.denoise,
            },
        },

        "10": { class_type: "VAEDecode",
                inputs: { samples: ["9", 0], vae: ["4", 2] } },

        "11": {
            class_type: "ImageCompositeMasked",
            inputs: { destination: ["1", 0], source: ["10", 0], mask: ["7", 0],
                      x: 0, y: 0, resize_source: false },
        },

        // ── Second pass: refinement ───────────────────────────────────────────
        "12": {
            class_type: "VAEEncodeForInpaint",
            inputs: { pixels: ["11", 0], vae: ["4", 2], mask: ["7", 0], grow_mask_by: 0 },
        },

        "13": {
            class_type: "KSampler",
            inputs: {
                model: ["4", 0],
                positive: ["5", 0],
                negative: ["6", 0],
                latent_image: ["12", 0],
                seed: Math.floor(Math.random() * 1_000_000_000),
                steps: 20,
                cfg: 5.0,
                sampler_name: cfg.sampler_name,
                scheduler: cfg.scheduler,
                denoise: 0.3,
            },
        },

        "14": { class_type: "VAEDecode",
                inputs: { samples: ["13", 0], vae: ["4", 2] } },

        "15": {
            class_type: "ImageCompositeMasked",
            inputs: { destination: ["11", 0], source: ["14", 0], mask: ["7", 0],
                      x: 0, y: 0, resize_source: false },
        },

        "16": { class_type: "SaveImage",
                inputs: { images: ["15", 0], filename_prefix: "pixxel_final" } },
    };
}

export async function POST(request) {
    try {
        const { mode, image, mask, targetObject, editPrompt, editStrength } = await request.json();

        if (!image || !editPrompt) {
            return NextResponse.json({ error: "Image and editPrompt are required" }, { status: 400 });
        }

        const timestamp = Date.now();
        const imageResult = await uploadImage(image, `pixxel_input_${timestamp}.png`);

        let workflow;
        if (mode === "auto") {
            if (!targetObject) return NextResponse.json({ error: "targetObject required for auto mode" }, { status: 400 });
            workflow = buildGroundingDinoWorkflow(imageResult.name, targetObject, editPrompt, editStrength || 1.0);
        } else {
            if (!mask) return NextResponse.json({ error: "mask required for brush mode" }, { status: 400 });
            const maskResult = await uploadImage(mask, `pixxel_mask_${timestamp}.png`);
            workflow = buildManualBrushWorkflow(imageResult.name, maskResult.name, editPrompt, editStrength || 1.0);
        }

        const { prompt_id } = await submitWorkflow(workflow);
        const resultInfo = await waitForResult(prompt_id);
        const resultImage = await getResultImage(resultInfo.filename, resultInfo.subfolder, resultInfo.type);

        return NextResponse.json({ success: true, image: resultImage });
    } catch (error) {
        console.error("[ComfyUI Route] Error:", error);
        return NextResponse.json({ error: error.message || "Failed to process image via ComfyUI" }, { status: 500 });
    }
}
