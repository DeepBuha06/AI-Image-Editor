import { NextResponse } from "next/server";

const COMFYUI_URL = process.env.NEXT_PUBLIC_COMFYUI_URL || "http://localhost:8189";

async function submitWorkflow(workflow) {
    const response = await fetch(`${COMFYUI_URL}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`ComfyUI error: ${response.status} - ${text}`);
    }
    return response.json();
}

async function waitForResult(promptId, timeout = 120000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const response = await fetch(`${COMFYUI_URL}/history/${promptId}`);
        const history = await response.json();

        if (history[promptId]) {
            const outputs = history[promptId].outputs;
            for (const nodeId of Object.keys(outputs)) {
                if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
                    const image = outputs[nodeId].images[0];
                    return {
                        filename: image.filename,
                        subfolder: image.subfolder || "",
                        type: image.type || "output",
                    };
                }
            }
            throw new Error("No image output found in workflow results");
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Workflow timed out after 120 seconds");
}

async function getResultImage(filename, subfolder, type) {
    const params = new URLSearchParams({ filename, subfolder, type });
    const response = await fetch(`${COMFYUI_URL}/view?${params}`);

    if (!response.ok) {
        throw new Error("Failed to fetch result image from ComfyUI");
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = response.headers.get("content-type") || "image/png";

    return `data:${contentType};base64,${base64}`;
}

async function uploadImage(base64Data, filename) {
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Clean, "base64");

    const formData = new FormData();
    formData.append("image", new Blob([buffer], { type: "image/png" }), filename);
    formData.append("overwrite", "true");

    const response = await fetch(`${COMFYUI_URL}/upload/image`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload image: ${errorText}`);
    }

    return response.json();
}

function buildGroundingDinoWorkflow(imageName, targetObject, editPrompt, editStrength = 1.0) {
    return {
        "1": { class_type: "LoadImage", inputs: { image: imageName } },
        "2": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd-v1-5-inpainting.ckpt" } },
        "3": { class_type: "CLIPTextEncode", inputs: { text: `${editPrompt}, high quality, detailed, photorealistic`, clip: ["2", 1] } },
        "4": { class_type: "CLIPTextEncode", inputs: { text: "blurry, duplicate, deformed, ugly, bad anatomy, bad lighting", clip: ["2", 1] } },
        "5": { class_type: "SAM2ModelLoader (segment anything2)", inputs: { model_name: "sam2_1_hiera_base_plus.pt" } },
        "6": { class_type: "GroundingDinoModelLoader (segment anything2)", inputs: { model_name: "GroundingDINO_SwinT_OGC (694MB)" } },
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
        "8": {
            class_type: "VAEEncodeForInpaint",
            inputs: { pixels: ["1", 0], vae: ["2", 2], mask: ["7", 1], grow_mask_by: 6 },
        },
        "9": {
            class_type: "KSampler",
            inputs: {
                model: ["2", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["8", 0],
                seed: Math.floor(Math.random() * 1000000000), steps: 30, cfg: 8.0, sampler_name: "euler", scheduler: "normal",
                denoise: editStrength,
            },
        },
        "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["2", 2] } },
        "11": {
            class_type: "ImageCompositeMasked",
            inputs: { destination: ["1", 0], source: ["10", 0], mask: ["7", 1], x: 0, y: 0, resize_source: false },
        },
        "12": { class_type: "SaveImage", inputs: { images: ["11", 0], filename_prefix: "pixxel_final" } },
    };
}

function buildManualBrushWorkflow(imageName, maskName, editPrompt, editStrength = 1.0) {
    return {
        "1": { class_type: "LoadImage", inputs: { image: imageName } },
        "2": { class_type: "LoadImage", inputs: { image: maskName } },
        "3": { class_type: "ImageToMask", inputs: { image: ["2", 0], channel: "red" } },
        "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd-v1-5-inpainting.ckpt" } },
        "5": { class_type: "CLIPTextEncode", inputs: { text: `${editPrompt}, high quality, detailed, photorealistic`, clip: ["4", 1] } },
        "6": { class_type: "CLIPTextEncode", inputs: { text: "blurry, duplicate, deformed, ugly, bad anatomy, bad lighting", clip: ["4", 1] } },
        "7": {
            class_type: "VAEEncodeForInpaint",
            inputs: { pixels: ["1", 0], vae: ["4", 2], mask: ["3", 0], grow_mask_by: 6 },
        },
        "8": {
            class_type: "KSampler",
            inputs: {
                model: ["4", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["7", 0],
                seed: Math.floor(Math.random() * 1000000000), steps: 30, cfg: 8.0, sampler_name: "euler", scheduler: "normal",
                denoise: editStrength,
            },
        },
        "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["4", 2] } },
        "10": {
            class_type: "ImageCompositeMasked",
            inputs: { destination: ["1", 0], source: ["9", 0], mask: ["3", 0], x: 0, y: 0, resize_source: false },
        },
        "11": { class_type: "SaveImage", inputs: { images: ["10", 0], filename_prefix: "pixxel_final" } },
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
