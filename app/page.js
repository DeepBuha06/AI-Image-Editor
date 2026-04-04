"use client";

import React, { useState, useEffect, useRef } from "react";
import { Upload, Sparkles, Loader2, Image as ImageIcon, Paintbrush, ScanSearch } from "lucide-react";
import * as fabric from "fabric";

export default function Page() {
    const [mode, setMode] = useState("auto"); // "auto" | "brush"
    const [image, setImage] = useState(null);
    const [targetObject, setTargetObject] = useState("");
    const [editPrompt, setEditPrompt] = useState("");
    const [editStrength, setEditStrength] = useState(1.0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [resultImage, setResultImage] = useState(null);

    const canvasRef = useRef(null);
    const fabricCanvasRef = useRef(null);
    const containerRef = useRef(null);

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImage(e.target.result);
                setResultImage(null); // Clear previous result
            };
            reader.readAsDataURL(file);
        }
    };

    useEffect(() => {
        if (!image || !canvasRef.current) return;

        if (fabricCanvasRef.current) {
            fabricCanvasRef.current.dispose();
        }

        const initCanvas = async () => {
            const img = await fabric.FabricImage.fromURL(image);
            const canvas = new fabric.Canvas(canvasRef.current, {
                width: img.width,
                height: img.height,
                isDrawingMode: mode === "brush",
            });

            // Background black, image drawn on top. Mask will be white.
            canvas.backgroundColor = "black";
            canvas.backgroundImage = img;

            const brush = new fabric.PencilBrush(canvas);
            brush.color = "white";
            brush.width = Math.max(img.width * 0.05, 20); // 5% of image width
            canvas.freeDrawingBrush = brush;

            fabricCanvasRef.current = canvas;
            scaleCanvasToFit();
        };
        initCanvas();

        return () => {
            if (fabricCanvasRef.current) {
                fabricCanvasRef.current.dispose();
            }
        };
    }, [image, mode]);

    const scaleCanvasToFit = () => {
        if (!fabricCanvasRef.current || !containerRef.current) return;
        const canvas = fabricCanvasRef.current;

        // Pure DOM scaling to avoid any internal Fabric coordinate offset bugs
        const cw = containerRef.current.clientWidth;
        const ch = containerRef.current.clientHeight;

        const scale = Math.min(cw / canvas.width, ch / canvas.height) * 0.95;
        const canvasWrap = canvas.getElement().parentElement;
        if (canvasWrap) {
            canvasWrap.style.transform = `scale(${scale})`;
            canvasWrap.style.transformOrigin = "top center";
        }
    };

    useEffect(() => {
        window.addEventListener("resize", scaleCanvasToFit);
        return () => window.removeEventListener("resize", scaleCanvasToFit);
    }, []);

    const handleExecute = async () => {
        if (mode === "auto" && (!image || !targetObject || !editPrompt)) {
            alert("Please enter both target object and edit instruction.");
            return;
        }
        if (mode === "brush" && (!image || !editPrompt)) {
            alert("Please draw on the image and enter an edit instruction.");
            return;
        }

        setIsProcessing(true);
        let maskDataUrl = null;

        if (mode === "brush" && fabricCanvasRef.current) {
            const canvas = fabricCanvasRef.current;
            // Extract Mask: Hide background, return shapes
            const bgImg = canvas.backgroundImage;
            canvas.backgroundImage = null;
            canvas.backgroundColor = "black";

            const objects = canvas.getObjects();
            if (objects.length === 0) {
                alert("Please draw a mask using the brush first.");
                setIsProcessing(false);
                canvas.backgroundImage = bgImg; // Restore
                return;
            }

            canvas.requestRenderAll();
            maskDataUrl = canvas.toDataURL({ format: "png", quality: 1, multiplier: 1 });
            canvas.backgroundImage = bgImg; // Restore
            canvas.requestRenderAll();
        }

        try {
            const res = await fetch("/api/comfyui", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode,
                    image,
                    mask: maskDataUrl,
                    targetObject,
                    editPrompt,
                    editStrength,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to process image");

            setResultImage(data.image);
        } catch (err) {
            alert(err.message);
            console.error(err);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-row p-8 gap-8 font-sans">

            {/* Sidebar Controls */}
            <div className="w-[420px] shrink-0 flex flex-col gap-6 bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl overflow-y-auto">
                <div className="flex items-center gap-3">
                    <Sparkles className="text-cyan-400 w-6 h-6" />
                    <h1 className="text-xl font-bold tracking-tight">PIXXEL AI</h1>
                </div>

                <div className="pt-4 border-t border-neutral-800">
                    <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2 block">Detection Mode</label>
                    <div className="flex bg-neutral-950 rounded-lg p-1 border border-neutral-800">
                        <button
                            onClick={() => setMode("auto")}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-md transition ${mode === "auto" ? "bg-cyan-900/50 text-cyan-400 shadow-sm" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            <ScanSearch className="w-4 h-4" /> Auto Select
                        </button>
                        <button
                            onClick={() => setMode("brush")}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-md transition ${mode === "brush" ? "bg-purple-900/50 text-purple-400 shadow-sm" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            <Paintbrush className="w-4 h-4" /> Manual Brush
                        </button>
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-2">
                        {mode === "auto" ? "Best for EDITING existing things (e.g. changing shirt color)." : "Best for ADDING things to empty spaces or strict manual control."}
                    </p>
                </div>

                <div className="space-y-5">
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">1. Base Image</label>
                        <label className="flex items-center justify-center w-full h-20 px-4 transition bg-neutral-950 border-2 border-neutral-800 border-dashed rounded-xl appearance-none cursor-pointer hover:border-cyan-500/50 hover:bg-neutral-900 focus:outline-none">
                            <span className="flex items-center space-x-2 text-sm text-neutral-400">
                                <Upload className="w-4 h-4" />
                                <span>Upload a file</span>
                            </span>
                            <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                        </label>
                    </div>

                    {mode === "auto" && (
                        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                            <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">2. What to select?</label>
                            <input
                                type="text"
                                placeholder="e.g., 'the white shirt', 'the car'"
                                value={targetObject}
                                onChange={(e) => setTargetObject(e.target.value)}
                                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all placeholder:text-neutral-600"
                            />
                            <p className="text-[10px] text-neutral-500">AI finds this object automatically.</p>
                        </div>
                    )}

                    {mode === "brush" && (
                        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                            <label className="text-xs text-purple-400 font-semibold uppercase tracking-wider">2. Draw on Image</label>
                            <p className="text-xs text-neutral-400">Use your mouse to draw exactly where you want the new object to appear on the canvas to the right.</p>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">3. Edit instruction</label>
                        <textarea
                            placeholder={mode === "auto" ? "e.g., 'a red shirt'" : "e.g., 'a leather cowboy hat'"}
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            rows={2}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all resize-none placeholder:text-neutral-600"
                        />
                    </div>

                    <div className="space-y-1.5 pb-2">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">4. Edit Strength</label>
                            <span className="text-xs text-cyan-400 font-mono">{editStrength.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min="0.3"
                            max="1.0"
                            step="0.05"
                            value={editStrength}
                            onChange={(e) => setEditStrength(parseFloat(e.target.value))}
                            className="w-full accent-cyan-500"
                        />
                        <div className="flex justify-between text-[10px] text-neutral-500 font-medium px-1">
                            <span>Recolor (0.6)</span>
                            <span>Replace (1.0)</span>
                        </div>
                    </div>

                    <button
                        onClick={handleExecute}
                        disabled={!image || !editPrompt || isProcessing || (mode === "auto" && !targetObject)}
                        className="w-full bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-3 shadow-lg shadow-cyan-900/20 transition-all flex items-center justify-center gap-2"
                    >
                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {isProcessing ? "Processing via ComfyUI..." : "Run AI Output"}
                    </button>
                </div>
            </div>

            {/* Main Preview Area */}
            <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl flex flex-col overflow-hidden">

                <div className="flex-1 flex gap-4 overflow-hidden relative">

                    <div className="flex-1 flex flex-col gap-2 min-h-0 bg-neutral-950 rounded-xl border border-neutral-800 overflow-hidden relative" ref={containerRef}>
                        <span className="absolute top-3 left-3 z-10 bg-black/50 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm">
                            ORIGINAL / EDIT ZONE
                        </span>
                        {!image && (
                            <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-sm">Upload an image to start</div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                            <canvas ref={canvasRef} />
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col gap-2 min-h-0 bg-neutral-950 rounded-xl border border-cyan-900/30 overflow-hidden relative">
                        <span className="absolute top-3 left-3 z-10 bg-cyan-900/50 text-cyan-200 text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm">
                            RESULT
                        </span>
                        <div className="absolute inset-0 flex items-center justify-center p-4">
                            {resultImage ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={resultImage} alt="Result" className="max-w-full max-h-full object-contain" />
                            ) : isProcessing ? (
                                <div className="flex flex-col items-center gap-3">
                                    <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
                                    <span className="text-xs text-cyan-500/80">Segmenting and Inpainting...</span>
                                </div>
                            ) : (
                                <div className="text-neutral-600 text-sm">Awaiting AI execution</div>
                            )}
                        </div>
                    </div>

                </div>
            </div>

        </div>
    );
}
