import { NextResponse } from "next/server";
import {
    fetchObjectInfo,
    findClassType,
    getResultImage,
    submitWorkflow,
    uploadImage,
    waitForResult,
} from "../../../lib/comfyui";

function buildFusionWorkflowWithMask(imageName, maskName, addPrompt, placementHint) {
    const positivePrompt = `${addPrompt}, photorealistic, consistent lighting, natural scene integration, 8k, sharp focus` +
        (placementHint ? `, ${placementHint}` : "");
    const negativePrompt = "floating, disconnected, unrealistic scale, bad anatomy, deformed, artifacts, watermark";

    return {
        "1": {
            class_type: "LoadImage",
            inputs: { image: imageName },
        },
        "2": {
            class_type: "ImageScale",
            inputs: {
                image: ["1", 0],
                width: 1024,
                height: 1024,
                upscale_method: "lanczos",
                crop: "disabled",
            },
        },
        "3": {
            class_type: "LoadImage",
            inputs: { image: maskName },
        },
        "4": {
            class_type: "ImageScale",
            inputs: {
                image: ["3", 0],
                width: 1024,
                height: 1024,
                upscale_method: "nearest-exact",
                crop: "disabled",
            },
        },
        "5": {
            class_type: "ImageToMask",
            inputs: {
                image: ["4", 0],
                channel: "red",
            },
        },
        "6": {
            class_type: "GrowMask",
            inputs: {
                mask: ["5", 0],
                expand: 10,
                tapered_corners: true,
            },
        },
        "7": {
            class_type: "CheckpointLoaderSimple",
            inputs: {
                ckpt_name: "sd_xl_base_1.0.safetensors",
            },
        },
        "8": {
            class_type: "CLIPTextEncode",
            inputs: {
                text: positivePrompt,
                clip: ["7", 1],
            },
        },
        "9": {
            class_type: "CLIPTextEncode",
            inputs: {
                text: negativePrompt,
                clip: ["7", 1],
            },
        },
        "10": {
            class_type: "VAEEncode",
            inputs: {
                pixels: ["2", 0],
                vae: ["7", 2],
            },
        },
        "11": {
            class_type: "SetLatentNoiseMask",
            inputs: {
                samples: ["10", 0],
                mask: ["6", 0],
            },
        },
        "12": {
            class_type: "KSampler",
            inputs: {
                model: ["7", 0],
                positive: ["8", 0],
                negative: ["9", 0],
                latent_image: ["11", 0],
                seed: Math.floor(Math.random() * 1_000_000_000),
                steps: 40,
                cfg: 7.0,
                sampler_name: "dpmpp_2m",
                scheduler: "karras",
                denoise: 0.95,
            },
        },
        "13": {
            class_type: "VAEDecode",
            inputs: {
                samples: ["12", 0],
                vae: ["7", 2],
            },
        },
        "14": {
            class_type: "ImageCompositeMasked",
            inputs: {
                destination: ["2", 0],
                source: ["13", 0],
                mask: ["6", 0],
                x: 0,
                y: 0,
                resize_source: false,
            },
        },
        "15": {
            class_type: "SaveImage",
            inputs: {
                images: ["14", 0],
                filename_prefix: "pixxel_fusion",
            },
        },
    };
}

function buildFusionWorkflowAutoPlacement(imageName, addPrompt, placementHint, florenceClass) {
    const positivePrompt = `${addPrompt}, photorealistic, consistent lighting, natural scene integration, 8k, sharp focus` +
        (placementHint ? `, ${placementHint}` : "");
    const negativePrompt = "floating, disconnected, unrealistic scale, bad anatomy, deformed, artifacts, watermark";

    return {
        "1": {
            class_type: "LoadImage",
            inputs: { image: imageName },
        },
        "2": {
            class_type: "ImageScale",
            inputs: {
                image: ["1", 0],
                width: 1024,
                height: 1024,
                upscale_method: "lanczos",
                crop: "disabled",
            },
        },

        // Florence-2 is used to parse scene semantics before generation when no manual mask is provided.
        "3": {
            class_type: florenceClass,
            inputs: {
                image: ["2", 0],
                text_input: placementHint || addPrompt,
                task: "detailed_caption",
            },
        },
        "4": {
            class_type: "SolidMask",
            inputs: {
                value: 1.0,
                width: 1024,
                height: 1024,
            },
        },
        "5": {
            class_type: "CheckpointLoaderSimple",
            inputs: {
                ckpt_name: "sd_xl_base_1.0.safetensors",
            },
        },
        "6": {
            class_type: "CLIPTextEncode",
            inputs: {
                text: positivePrompt,
                clip: ["5", 1],
            },
        },
        "7": {
            class_type: "CLIPTextEncode",
            inputs: {
                text: negativePrompt,
                clip: ["5", 1],
            },
        },
        "8": {
            class_type: "VAEEncode",
            inputs: {
                pixels: ["2", 0],
                vae: ["5", 2],
            },
        },
        "9": {
            class_type: "SetLatentNoiseMask",
            inputs: {
                samples: ["8", 0],
                mask: ["4", 0],
            },
        },
        "10": {
            class_type: "KSampler",
            inputs: {
                model: ["5", 0],
                positive: ["6", 0],
                negative: ["7", 0],
                latent_image: ["9", 0],
                seed: Math.floor(Math.random() * 1_000_000_000),
                steps: 40,
                cfg: 7.0,
                sampler_name: "dpmpp_2m",
                scheduler: "karras",
                denoise: 0.95,
            },
        },
        "11": {
            class_type: "VAEDecode",
            inputs: {
                samples: ["10", 0],
                vae: ["5", 2],
            },
        },
        "12": {
            class_type: "SaveImage",
            inputs: {
                images: ["11", 0],
                filename_prefix: "pixxel_fusion",
            },
        },
    };
}

export async function POST(request) {
    try {
        const { image, addPrompt, placementHint, mask } = await request.json();

        if (!image || !addPrompt) {
            return NextResponse.json({ error: "image and addPrompt are required" }, { status: 400 });
        }

        const timestamp = Date.now();
        const uploadedImage = await uploadImage(image, `pixxel_fusion_input_${timestamp}.png`);

        let workflow;
        if (mask) {
            const uploadedMask = await uploadImage(mask, `pixxel_fusion_mask_${timestamp}.png`);
            workflow = buildFusionWorkflowWithMask(uploadedImage.name, uploadedMask.name, addPrompt, placementHint);
        } else {
            const objectInfo = await fetchObjectInfo();
            const florenceClass = findClassType(
                objectInfo,
                ["Florence2Run", "Florence2", "Florence2ModelRun"],
                ["florence"],
            );

            if (!florenceClass) {
                throw new Error("No Florence-2 node found in ComfyUI object_info for auto-placement mode");
            }

            workflow = buildFusionWorkflowAutoPlacement(uploadedImage.name, addPrompt, placementHint, florenceClass);
        }

        const { prompt_id } = await submitWorkflow(workflow);
        const resultInfo = await waitForResult(prompt_id);
        const resultImage = await getResultImage(resultInfo.filename, resultInfo.subfolder, resultInfo.type);

        return NextResponse.json({ success: true, image: resultImage });
    } catch (error) {
        console.error("[Fusion Route] Error:", error);
        return NextResponse.json({ error: error.message || "Failed to process fusion request" }, { status: 500 });
    }
}
