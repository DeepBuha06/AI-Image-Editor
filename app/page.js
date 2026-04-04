"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, Sparkles, Loader2, Paintbrush, ScanSearch, Undo2 } from "lucide-react";

export default function Page() {
    const [mode, setMode] = useState("auto");
    const [imageDataUrl, setImageDataUrl] = useState(null);
    const [targetObject, setTargetObject] = useState("");
    const [editPrompt, setEditPrompt] = useState("");
    const [editStrength, setEditStrength] = useState(1.0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [resultImage, setResultImage] = useState(null);
    const [brushSize, setBrushSize] = useState(30);

    // For brush mode: we draw on a native canvas, no Fabric.js at all
    const canvasRef = useRef(null);
    const isDrawing = useRef(false);
    const imgRef = useRef(null); // holds the HTMLImageElement for the uploaded photo
    const pathsRef = useRef([]); // stores drawn paths for undo

    // Load the uploaded image into an HTMLImageElement
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            setImageDataUrl(dataUrl);
            setResultImage(null);
            pathsRef.current = [];

            const img = new Image();
            img.onload = () => {
                imgRef.current = img;
                if (mode === "brush") drawCanvasWithImage(img);
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    };

    // Draw the base image onto the canvas (brush mode)
    const drawCanvasWithImage = useCallback((img) => {
        const canvas = canvasRef.current;
        if (!canvas || !img) return;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        // Redraw all existing brush strokes on top
        for (const path of pathsRef.current) {
            ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
            ctx.lineWidth = path.size;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (let i = 0; i < path.points.length; i++) {
                const p = path.points[i];
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
    }, []);

    // When switching to brush mode or image changes, redraw
    useEffect(() => {
        if (mode === "brush" && imgRef.current) {
            // Small delay to ensure canvas DOM is rendered
            setTimeout(() => drawCanvasWithImage(imgRef.current), 50);
        }
    }, [mode, imageDataUrl, drawCanvasWithImage]);

    // --- Brush drawing handlers ---
    const getCanvasCoords = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
        };
    };

    const onPointerDown = (e) => {
        isDrawing.current = true;
        const p = getCanvasCoords(e);
        pathsRef.current.push({ points: [p], size: brushSize });
    };

    const onPointerMove = (e) => {
        if (!isDrawing.current) return;
        const p = getCanvasCoords(e);
        const currentPath = pathsRef.current[pathsRef.current.length - 1];
        currentPath.points.push(p);

        // Draw incrementally
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
        ctx.lineWidth = brushSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const pts = currentPath.points;
        if (pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            ctx.stroke();
        }
    };

    const onPointerUp = () => {
        isDrawing.current = false;
    };

    const handleUndo = () => {
        pathsRef.current.pop();
        if (imgRef.current) drawCanvasWithImage(imgRef.current);
    };

    // Extract a black-and-white mask from drawn paths
    const extractMask = () => {
        const img = imgRef.current;
        if (!img) return null;
        const offscreen = document.createElement("canvas");
        offscreen.width = img.naturalWidth;
        offscreen.height = img.naturalHeight;
        const ctx = offscreen.getContext("2d");

        // Black background = untouched areas
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);

        // White strokes = areas to inpaint
        for (const path of pathsRef.current) {
            ctx.strokeStyle = "white";
            ctx.lineWidth = path.size;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (let i = 0; i < path.points.length; i++) {
                const p = path.points[i];
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
        return offscreen.toDataURL("image/png");
    };

    const handleExecute = async () => {
        if (!imageDataUrl || !editPrompt) {
            alert("Upload an image and enter an edit instruction.");
            return;
        }
        if (mode === "auto" && !targetObject) {
            alert("Enter the object to select in 'What to select?'");
            return;
        }
        if (mode === "brush" && pathsRef.current.length === 0) {
            alert("Draw on the image to mark where to edit.");
            return;
        }

        setIsProcessing(true);
        try {
            const body = {
                mode,
                image: imageDataUrl,
                editPrompt,
                editStrength,
            };

            if (mode === "auto") {
                body.targetObject = targetObject;
            } else {
                body.mask = extractMask();
            }

            const res = await fetch("/api/comfyui", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Processing failed");
            setResultImage(data.image);
        } catch (err) {
            alert(err.message);
            console.error(err);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-row p-6 gap-6 font-sans">
            {/* ───── Sidebar ───── */}
            <div className="w-[400px] shrink-0 flex flex-col gap-5 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-2xl overflow-y-auto max-h-screen">
                <div className="flex items-center gap-3">
                    <Sparkles className="text-cyan-400 w-6 h-6" />
                    <h1 className="text-xl font-bold tracking-tight">PIXXEL AI</h1>
                </div>

                {/* Mode Toggle */}
                <div className="pt-3 border-t border-neutral-800">
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 block">Mode</span>
                    <div className="flex bg-neutral-950 rounded-lg p-1 border border-neutral-800">
                        <button onClick={() => setMode("auto")}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-md transition ${mode === "auto" ? "bg-cyan-900/50 text-cyan-400" : "text-neutral-500 hover:text-neutral-300"}`}>
                            <ScanSearch className="w-3.5 h-3.5" /> Auto Select
                        </button>
                        <button onClick={() => setMode("brush")}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-md transition ${mode === "brush" ? "bg-purple-900/50 text-purple-400" : "text-neutral-500 hover:text-neutral-300"}`}>
                            <Paintbrush className="w-3.5 h-3.5" /> Brush
                        </button>
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-1.5">
                        {mode === "auto" ? "AI finds & masks objects for you. Best for editing existing things." : "You paint the mask. Best for adding objects to empty space."}
                    </p>
                </div>

                {/* Upload */}
                <div>
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">1 · Image</span>
                    <label htmlFor="pixxel-upload" className="flex items-center justify-center w-full h-16 bg-neutral-950 border-2 border-dashed border-neutral-700 rounded-xl cursor-pointer hover:border-cyan-500/50 transition">
                        <Upload className="w-4 h-4 text-neutral-500 mr-2" />
                        <span className="text-sm text-neutral-400">{imageDataUrl ? "Change image" : "Upload image"}</span>
                    </label>
                    <input id="pixxel-upload" type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </div>

                {/* Auto: target object */}
                {mode === "auto" && (
                    <div>
                        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">2 · What to select?</span>
                        <input type="text" placeholder="e.g. 'the shirt', 'the car'"
                            value={targetObject} onChange={(e) => setTargetObject(e.target.value)}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 placeholder:text-neutral-600" />
                        <p className="text-[10px] text-neutral-500 mt-1">GroundingDINO + SAM2 will mask it automatically.</p>
                    </div>
                )}

                {/* Brush: controls */}
                {mode === "brush" && (
                    <div>
                        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">2 · Draw mask</span>
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-neutral-400 shrink-0">Size</span>
                            <input type="range" min="5" max="100" value={brushSize}
                                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                className="flex-1 accent-purple-500" />
                            <span className="text-xs text-purple-400 font-mono w-6 text-right">{brushSize}</span>
                            <button onClick={handleUndo} title="Undo last stroke"
                                className="p-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition">
                                <Undo2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <p className="text-[10px] text-neutral-500 mt-1">Paint red on the preview canvas where you want the AI to generate.</p>
                    </div>
                )}

                {/* Prompt */}
                <div>
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">3 · Edit instruction</span>
                    <textarea placeholder={mode === "auto" ? "e.g. 'a bright red shirt'" : "e.g. 'a leather cowboy hat'"}
                        value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={2}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none placeholder:text-neutral-600" />
                </div>

                {/* Strength */}
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">4 · Strength</span>
                        <span className="text-xs text-cyan-400 font-mono">{editStrength.toFixed(2)}</span>
                    </div>
                    <input type="range" min="0.3" max="1.0" step="0.05" value={editStrength}
                        onChange={(e) => setEditStrength(parseFloat(e.target.value))}
                        className="w-full accent-cyan-500" />
                    <div className="flex justify-between text-[10px] text-neutral-500 mt-0.5 px-0.5">
                        <span>Recolor</span><span>Replace</span>
                    </div>
                </div>

                {/* Execute */}
                <button onClick={handleExecute}
                    disabled={!imageDataUrl || !editPrompt || isProcessing || (mode === "auto" && !targetObject)}
                    className="w-full bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-3 shadow-lg transition flex items-center justify-center gap-2 mt-auto">
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isProcessing ? "Processing…" : "Run AI Edit"}
                </button>
            </div>

            {/* ───── Canvas Area ───── */}
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
                {/* Left: Original / Brush canvas */}
                <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-2xl flex flex-col overflow-hidden relative">
                    <span className="absolute top-3 left-3 z-10 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm">
                        {mode === "brush" ? "DRAW MASK HERE" : "ORIGINAL"}
                    </span>
                    <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                        {!imageDataUrl ? (
                            <span className="text-neutral-600 text-sm">Upload an image to start</span>
                        ) : mode === "auto" ? (
                            /* Auto mode: just show the image, no canvas needed */
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={imageDataUrl} alt="Original" className="max-w-full max-h-full object-contain rounded-lg" />
                        ) : (
                            /* Brush mode: native canvas for drawing */
                            <canvas
                                ref={canvasRef}
                                onPointerDown={onPointerDown}
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerUp}
                                onPointerLeave={onPointerUp}
                                className="max-w-full max-h-full object-contain rounded-lg cursor-crosshair"
                                style={{ touchAction: "none" }}
                            />
                        )}
                    </div>
                </div>

                {/* Right: Result */}
                <div className="flex-1 bg-neutral-900 border border-cyan-900/30 rounded-2xl flex flex-col overflow-hidden relative">
                    <span className="absolute top-3 left-3 z-10 bg-cyan-900/50 text-cyan-200 text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm">
                        RESULT
                    </span>
                    <div className="flex-1 flex items-center justify-center p-4">
                        {resultImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={resultImage} alt="Result" className="max-w-full max-h-full object-contain rounded-lg" />
                        ) : isProcessing ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
                                <span className="text-xs text-cyan-500/80">Segmenting & Inpainting…</span>
                            </div>
                        ) : (
                            <span className="text-neutral-600 text-sm">Result will appear here</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
