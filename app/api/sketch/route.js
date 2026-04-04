import { NextResponse } from "next/server";
import {
    getResultImage,
    submitWorkflow,
    uploadImage,
    waitForResult,
} from "../../../lib/comfyui";

function buildSketchWorkflow(imageName, sketchName, sketchPrompt) {
    const positivePrompt = `${sketchPrompt}, highly detailed, photorealistic, seamlessly integrated into scene, consistent lighting and perspective`;
    const negativePrompt = "sketch lines, drawing artifacts, rough edges, unrealistic";

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
            inputs: { image: sketchName },
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
                expand: 8,
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
            class_type: "ControlNetLoader",
            inputs: {
                control_net_name: "controlnet_scribble_sdxl.safetensors",
            },
        },
        "11": {
            class_type: "ControlNetApplyAdvanced",
            inputs: {
                positive: ["8", 0],
                negative: ["9", 0],
                control_net: ["10", 0],
                image: ["4", 0],
                strength: 0.8,
                start_percent: 0.0,
                end_percent: 1.0,
            },
        },
        "12": {
            class_type: "VAEEncode",
            inputs: {
                pixels: ["2", 0],
                vae: ["7", 2],
            },
        },
        "13": {
            class_type: "SetLatentNoiseMask",
            inputs: {
                samples: ["12", 0],
                mask: ["6", 0],
            },
        },
        "14": {
            class_type: "KSampler",
            inputs: {
                model: ["7", 0],
                positive: ["11", 0],
                negative: ["11", 1],
                latent_image: ["13", 0],
                seed: Math.floor(Math.random() * 1_000_000_000),
                steps: 40,
                cfg: 7.5,
                sampler_name: "dpmpp_2m",
                scheduler: "karras",
                denoise: 0.9,
            },
        },
        "15": {
            class_type: "VAEDecode",
            inputs: {
                samples: ["14", 0],
                vae: ["7", 2],
            },
        },
        "16": {
            class_type: "ImageCompositeMasked",
            inputs: {
                destination: ["2", 0],
                source: ["15", 0],
                mask: ["6", 0],
                x: 0,
                y: 0,
                resize_source: false,
            },
        },
        "17": {
            class_type: "SaveImage",
            inputs: {
                images: ["16", 0],
                filename_prefix: "pixxel_sketch",
            },
        },
    };
}

export async function POST(request) {
    try {
        const { image, sketch, sketchPrompt } = await request.json();

        if (!image || !sketch || !sketchPrompt) {
            return NextResponse.json(
                { error: "image, sketch, and sketchPrompt are required" },
                { status: 400 },
            );
        }

        const timestamp = Date.now();
        const uploadedImage = await uploadImage(image, `pixxel_sketch_input_${timestamp}.png`);
        const uploadedSketch = await uploadImage(sketch, `pixxel_sketch_mask_${timestamp}.png`);

        const workflow = buildSketchWorkflow(uploadedImage.name, uploadedSketch.name, sketchPrompt);
        const { prompt_id } = await submitWorkflow(workflow);
        const resultInfo = await waitForResult(prompt_id);
        const resultImage = await getResultImage(resultInfo.filename, resultInfo.subfolder, resultInfo.type);

        return NextResponse.json({ success: true, image: resultImage });
    } catch (error) {
        console.error("[Sketch Route] Error:", error);
        return NextResponse.json({ error: error.message || "Failed to process sketch request" }, { status: 500 });
    }
}
