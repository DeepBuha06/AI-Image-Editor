const COMFYUI_URL = process.env.NEXT_PUBLIC_COMFYUI_URL || "http://10.0.62.179:8189";

export async function submitWorkflow(workflow) {
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

export async function waitForResult(promptId, timeout = 120000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const response = await fetch(`${COMFYUI_URL}/history/${promptId}`);
        const history = await response.json();

        if (history[promptId]) {
            const outputs = history[promptId].outputs || {};
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

export async function getResultImage(filename, subfolder, type) {
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

export async function uploadImage(base64Data, filename) {
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

export async function fetchObjectInfo() {
    const response = await fetch(`${COMFYUI_URL}/object_info`);
    if (!response.ok) return {};
    return response.json();
}

export function findClassType(objectInfo, preferredNames, containsNeedles = []) {
    for (const name of preferredNames) {
        if (objectInfo[name]) return name;
    }

    const allClassTypes = Object.keys(objectInfo || {});
    const lowered = allClassTypes.map((entry) => ({ original: entry, lower: entry.toLowerCase() }));

    if (containsNeedles.length > 0) {
        const hit = lowered.find((entry) => containsNeedles.every((needle) => entry.lower.includes(needle.toLowerCase())));
        if (hit) return hit.original;
    }

    if (preferredNames.includes("LamaRemover")) {
        const lamaMatch = lowered.find((entry) => entry.lower.includes("lama") && entry.lower.includes("remov"));
        if (lamaMatch) return lamaMatch.original;
    }

    return null;
}
