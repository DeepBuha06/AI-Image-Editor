import React from 'react';
import { History, ArrowLeftRight } from 'lucide-react';

export default function EditHistory({ history, onRestore }) {
    if (!history || history.length === 0) return null;

    return (
        <div className="pt-3 border-t border-neutral-800">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                <History className="w-3 h-3" /> Recent Edits
            </span>
            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {history.map((item, idx) => (
                    <div
                        key={idx}
                        className="relative w-16 h-16 shrink-0 rounded-md overflow-hidden border border-neutral-700 cursor-pointer group"
                        onClick={() => onRestore(item.image)}
                        title={item.prompt}
                    >
                        <img src={item.image} alt={`Edit ${idx}`} className="w-full h-full object-cover transition group-hover:scale-110" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                            <ArrowLeftRight className="w-4 h-4 text-white" />
                        </div>
                    </div>
                ))}
            </div>
            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar { height: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
            `}</style>
        </div>
    );
}
