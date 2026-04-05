import React from 'react';
import { PencilRuler, Eraser, Combine, Paintbrush } from 'lucide-react';

export default function ModeSelector({ selectedMode, onModeChange }) {
    const modes = [
        { id: "edit", label: "Edit Object", icon: PencilRuler, desc: "Change color or texture" },
        { id: "remove", label: "Remove Object", icon: Eraser, desc: "Erase and fill background" },
        { id: "fusion", label: "Add Object", icon: Combine, desc: "Insert into empty space" },
        { id: "sketch", label: "Sketch Insert", icon: Paintbrush, desc: "Draw shape to insert" },
    ];

    return (
        <div className="pt-3 border-t border-neutral-800">
            <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">1 · Action Mode</span>
            <div className="grid grid-cols-2 gap-1.5 bg-neutral-950 rounded-lg p-1.5 border border-neutral-800">
                {modes.map(mode => {
                    const Icon = mode.icon;
                    const isActive = selectedMode === mode.id;
                    return (
                        <button
                            key={mode.id}
                            onClick={() => onModeChange(mode.id)}
                            className={`flex flex-col items-center justify-center gap-1 py-2 text-xs font-semibold rounded-md transition ${isActive ? "bg-cyan-900/50 text-cyan-400 border border-cyan-800/50 shadow-inner" : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900"}`}
                        >
                            <Icon className="w-4 h-4" />
                            {mode.label}
                        </button>
                    )
                })}
            </div>
            <p className="text-[10px] text-neutral-500 mt-2 text-center">
                {modes.find(m => m.id === selectedMode)?.desc || ""}
            </p>
        </div>
    );
}
