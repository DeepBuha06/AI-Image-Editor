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

function buildGroundingDinoWorkflow(imageName, targetObject, editPrompt, editStrength = 0.95) {
    const enhancedPositive = `${editPrompt}, highly detailed, sharp focus, professional photo, 8k, photorealistic, consistent lighting`;
    const negativePrompt = "blurry, deformed, ugly, bad anatomy, bad lighting, duplicate, watermark, text, oversaturated, unrealistic, cartoon, painting, low quality, noise";

    return {
        "1": {
            class_type: "LoadImage",
            inputs: { image: imageName }
        },
        "2": {
            class_type: "ImageScale",
            inputs: {
                image: ["1", 0],
                width: 1024,
                height: 1024,
                upscale_method: "lanczos",
                crop: "disabled"
            }
        },
        "3": {
            class_type: "CheckpointLoaderSimple",
            inputs: { ckpt_name: "sd_xl_base_1.0_inpainting_0.1.safetensors" }
        },
        "4": {
            class_type: "CLIPTextEncode",
            inputs: { text: enhancedPositive, clip: ["3", 1] }
        },
        "5": {
            class_type: "CLIPTextEncode",
            inputs: { text: negativePrompt, clip: ["3", 1] }
        },
        "6": {
            class_type: "SAM2ModelLoader (segment anything2)",
            inputs: { model_name: "sam2_1_hiera_base_plus.pt" }
        },
        "7": {
            class_type: "GroundingDinoModelLoader (segment anything2)",
            inputs: { model_name: "GroundingDINO_SwinT_OGC (694MB)" }
        },
        "8": {
            class_type: "GroundingDinoSAM2Segment (segment anything2)",
            inputs: {
                sam_model: ["6", 0],
                grounding_dino_model: ["7", 0],
                image: ["2", 0],        // scaled image, not raw
                prompt: targetObject,
                threshold: 0.3,
                keep_model_loaded: false,
            },
        },
        "9": {
            class_type: "VAEEncodeForInpaint",
            inputs: {
                pixels: ["2", 0],       // scaled image
                vae: ["3", 2],
                mask: ["8", 1],         // SAM2 mask output
                grow_mask_by: 8,
            },
        },
        "10": {
            class_type: "KSampler",
            inputs: {
                model: ["3", 0],
                positive: ["4", 0],
                negative: ["5", 0],
                latent_image: ["9", 0],
                seed: Math.floor(Math.random() * 1000000000),
                steps: 40,
                cfg: 7.0,
                sampler_name: "dpmpp_2m",
                scheduler: "karras",
                denoise: editStrength,
            },
        },
        "11": {
            class_type: "VAEDecode",
            inputs: { samples: ["10", 0], vae: ["3", 2] }
        },
        "12": {
            class_type: "SaveImage",
            inputs: { images: ["11", 0], filename_prefix: "pixxel_final" }
        },
    };
}

function buildManualBrushWorkflow(imageName, maskName, editPrompt, editStrength = 0.95) {
    const enhancedPositive = `${editPrompt}, highly detailed, sharp focus, professional photo, 8k, photorealistic, consistent lighting`;
    const negativePrompt = "blurry, deformed, ugly, bad anatomy, bad lighting, duplicate, watermark, text, oversaturated, unrealistic, cartoon, painting, low quality, noise";

    return {
        "1": {
            class_type: "LoadImage",
            inputs: { image: imageName }
        },
        "2": {
            class_type: "LoadImage",
            inputs: { image: maskName }
        },
        "3": {
            class_type: "ImageScale",
            inputs: {
                image: ["1", 0],
                width: 1024,
                height: 1024,
                upscale_method: "lanczos",
                crop: "disabled"
            }
        },
        "4": {
            class_type: "ImageScale",
            inputs: {
                image: ["2", 0],
                width: 1024,
                height: 1024,
                upscale_method: "lanczos",
                crop: "disabled"
            }
        },
        "5": {
            class_type: "ImageToMask",
            inputs: { image: ["4", 0], channel: "red" }
        },
        "6": {
            class_type: "CheckpointLoaderSimple",
            inputs: { ckpt_name: "sd_xl_base_1.0_inpainting_0.1.safetensors" }
        },
        "7": {
            class_type: "CLIPTextEncode",
            inputs: { text: enhancedPositive, clip: ["6", 1] }
        },
        "8": {
            class_type: "CLIPTextEncode",
            inputs: { text: negativePrompt, clip: ["6", 1] }
        },
        "9": {
            class_type: "VAEEncode",
            inputs: {
                pixels: ["3", 0],   // scaled image (use ["2",0] for GroundingDino workflow)
                vae: ["6", 2],      // (use ["3",2] for GroundingDino workflow)
            },
        },
        "9b": {
            class_type: "SetLatentNoiseMask",
            inputs: {
                samples: ["9", 0],
                mask: ["5", 0],     // your mask node output (use ["8",1] for GroundingDino workflow)
            },
        },
        "10": {
            class_type: "KSampler",
            inputs: {
                model: ["6", 0],
                positive: ["7", 0],
                negative: ["8", 0],
                latent_image: ["9b", 0],
                seed: Math.floor(Math.random() * 1000000000),
                steps: 40,
                cfg: 7.0,
                sampler_name: "dpmpp_2m",
                scheduler: "karras",
                denoise: editStrength,
            },
        },
        "11": {
            class_type: "VAEDecode",
            inputs: { samples: ["10", 0], vae: ["6", 2] }
        },
        "12": {
            class_type: "SaveImage",
            inputs: { images: ["11", 0], filename_prefix: "pixxel_final" }
        },
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
            workflow = buildGroundingDinoWorkflow(imageResult.name, targetObject, editPrompt, editStrength || 0.95);
        } else {
            if (!mask) return NextResponse.json({ error: "mask required for brush mode" }, { status: 400 });
            const maskResult = await uploadImage(mask, `pixxel_mask_${timestamp}.png`);
            workflow = buildManualBrushWorkflow(imageResult.name, maskResult.name, editPrompt, editStrength || 0.95);
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
