import { NextResponse } from "next/server";
import {
    fetchObjectInfo,
    findClassType,
    getResultImage,
    submitWorkflow,
    uploadImage,
    waitForResult,
} from "../../../lib/comfyui";

function buildAutoRemovalWorkflow(imageName, targetObject, classTypes) {
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
            class_type: "SAM2ModelLoader (segment anything2)",
            inputs: { model_name: "sam2.1_hiera_base_plus.pt" },
        },
        "4": {
            class_type: "GroundingDinoModelLoader (segment anything2)",
            inputs: { model_name: "groundingdino_swint_ogc.pth" },
        },
        "5": {
            class_type: "GroundingDinoSAM2Segment (segment anything2)",
            inputs: {
                sam_model: ["3", 0],
                grounding_dino_model: ["4", 0],
                image: ["2", 0],
                prompt: targetObject,
                threshold: 0.3,
                keep_model_loaded: false,
            },
        },
        "6": {
            class_type: "GrowMask",
            inputs: {
                mask: ["5", 1],
                expand: 12,
                tapered_corners: true,
            },
        },
        "7": {
            class_type: classTypes.lamaClass,
            inputs: {
                images: ["2", 0],
                masks: ["6", 0],
                gaussblur_radius: 6,
                mask_threshold: 127,
                invert_mask: false,
            },
        },
        "8": {
            class_type: "SaveImage",
            inputs: {
                images: ["7", 0],
                filename_prefix: "pixxel_removal",
            },
        },
    };
}

function buildBrushRemovalWorkflow(imageName, maskName, classTypes) {
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
                expand: 12,
                tapered_corners: true,
            },
        },
        "7": {
            class_type: classTypes.lamaClass,
            inputs: {
                images: ["2", 0],
                masks: ["6", 0],
                gaussblur_radius: 6,
                mask_threshold: 127,
                invert_mask: false,
            },
        },
        "8": {
            class_type: "SaveImage",
            inputs: {
                images: ["7", 0],
                filename_prefix: "pixxel_removal",
            },
        },
    };
}

export async function POST(request) {
    try {
        const { image, mask, targetObject, mode = "brush" } = await request.json();

        if (!image) {
            return NextResponse.json({ error: "image is required" }, { status: 400 });
        }

        if (!["auto", "brush"].includes(mode)) {
            return NextResponse.json({ error: "mode must be 'auto' or 'brush'" }, { status: 400 });
        }

        if (mode === "auto" && !targetObject) {
            return NextResponse.json({ error: "targetObject is required for auto mode" }, { status: 400 });
        }

        if (mode === "brush" && !mask) {
            return NextResponse.json({ error: "mask is required for brush mode" }, { status: 400 });
        }

        const timestamp = Date.now();
        const uploadedImage = await uploadImage(image, `pixxel_removal_input_${timestamp}.png`);
        const objectInfo = await fetchObjectInfo();

        const lamaClass = findClassType(objectInfo, ["LamaRemover", "LaMaRemover", "Lama Remove"]);
        if (!lamaClass) {
            throw new Error("Could not find a LaMa remover node in ComfyUI object_info");
        }

        const classTypes = { lamaClass };
        let workflow;

        if (mode === "auto") {
            workflow = buildAutoRemovalWorkflow(uploadedImage.name, targetObject, classTypes);
        } else {
            const uploadedMask = await uploadImage(mask, `pixxel_removal_mask_${timestamp}.png`);
            workflow = buildBrushRemovalWorkflow(uploadedImage.name, uploadedMask.name, classTypes);
        }

        const { prompt_id } = await submitWorkflow(workflow);
        const resultInfo = await waitForResult(prompt_id);
        const resultImage = await getResultImage(resultInfo.filename, resultInfo.subfolder, resultInfo.type);

        return NextResponse.json({ success: true, image: resultImage });
    } catch (error) {
        console.error("[Removal Route] Error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to process object removal" },
            { status: 500 },
        );
    }
}
