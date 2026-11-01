import React, { useState } from 'react';
import { UploadCloud, FileText, CheckCircle2 } from 'lucide-react';
import { playChimeCue } from '../../utils/tauriBridge';

interface DropZoneViewProps {
  onFileDrop?: (fileName: string) => void;
  stagedFile?: string | null;
}

export const DropZoneView: React.FC<DropZoneViewProps> = ({
  stagedFile: propStagedFile,
}) => {
  const [internalFile, setInternalFile] = useState<string | null>(null);
  const activeFile = propStagedFile !== undefined ? propStagedFile : internalFile;
  const progress = activeFile ? 100 : 0;

  // SVG Circular Ring Calculation
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const handleSimulatedDrop = () => {
    playChimeCue('ding');
    setInternalFile('Design_System_Spec.fig');
  };

  return (
    <div
      onClick={handleSimulatedDrop}
      className="w-full max-w-[700px] flex-1 px-6 pb-2.5 pt-1 flex items-center justify-between select-none transition-colors hover:bg-white/[0.02]"
    >
      {/* Left side: Drag & Drop Status */}
      <div className="flex flex-col justify-center min-w-0 flex-1 pr-3">
        <div className="flex items-center gap-2 mb-1">
          <UploadCloud className="w-4 h-4 text-island-blue shrink-0 animate-pulse" />
          <span className="text-[13px] font-semibold text-white tracking-tight">
            Drop Zone Pocket
          </span>
        </div>

        {activeFile ? (
          <div className="flex items-center gap-2 mt-1">
            <FileText className="w-4 h-4 text-island-secondary shrink-0 text-emerald-400" />
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] font-medium text-white truncate max-w-[280px]">
                {activeFile}
              </span>
              <span className="text-[10px] text-emerald-400 mt-0.5 font-medium">
                Berhasil Diterima & Disimpan
              </span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-island-secondary leading-snug">
            Lepaskan berkas di sini dari Windows Explorer untuk disimpan ke pocket.
          </p>
        )}
      </div>

      {/* Right side: Circular Progress Ring (AirDrop style in #0A84FF) */}
      <div className="relative w-[56px] h-[56px] shrink-0 flex items-center justify-center">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 56 56">
          {/* Background Ring */}
          <circle
            cx="28"
            cy="28"
            r={radius}
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth="3.5"
            fill="none"
          />
          {/* Radial Blue Progress Ring */}
          <circle
            cx="28"
            cy="28"
            r={radius}
            stroke="#0A84FF"
            strokeWidth="3.5"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
            className="transition-all duration-300"
          />
        </svg>

        {/* Center Indicator */}
        <div className="absolute inset-0 flex items-center justify-center">
          {progress >= 100 ? (
            <CheckCircle2 className="w-5 h-5 text-island-blue shrink-0 animate-in zoom-in-75 duration-200" />
          ) : (
            <span className="text-[11px] font-semibold text-island-blue/70 tabular-nums">
              Siap
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
