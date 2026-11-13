'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { UploadCloud, FileText, FileSpreadsheet, FileImage, File as FileIcon, X, RotateCw, AlertCircle, CheckCircle2 } from 'lucide-react';

export type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatEta(seconds: number): string {
  if (seconds <= 0) return 'almost done';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s left`;
}

/**
 * Lighter-weight alternative to useUploadTask for pages whose submit flow is
 * already bespoke (multi-field forms, existing OCR/read-progress steps) and
 * just need percent + ETA numbers fed by an XHR onProgress callback, without
 * adopting the full status/retry state machine.
 */
export function createProgressTracker(onUpdate: (percent: number, etaSeconds: number | null) => void) {
  let sample: { time: number; loaded: number } | null = null;
  return (loaded: number, total: number) => {
    if (total <= 0) return;
    const percent = Math.round((loaded / total) * 100);
    const now = Date.now();
    if (sample) {
      const elapsedSec = (now - sample.time) / 1000;
      const deltaBytes = loaded - sample.loaded;
      if (elapsedSec > 0.15 && deltaBytes > 0) {
        const bytesPerSec = deltaBytes / elapsedSec;
        onUpdate(percent, Math.max(0, (total - loaded) / bytesPerSec));
        sample = { time: now, loaded };
        return;
      }
    } else {
      sample = { time: now, loaded };
    }
    onUpdate(percent, null);
  };
}

function iconForFile(file: File) {
  const type = file.type || '';
  const name = file.name.toLowerCase();
  if (type.startsWith('image/')) return FileImage;
  if (type === 'application/pdf' || name.endsWith('.pdf')) return FileText;
  if (name.endsWith('.csv') || type.includes('spreadsheet') || name.endsWith('.xlsx')) return FileSpreadsheet;
  return FileIcon;
}

/**
 * Drives one file's progress/ETA/retry lifecycle from a caller-supplied `run`
 * function that performs the actual submit and reports loaded/total bytes as
 * it goes (typically via XMLHttpRequest's upload.onprogress). The file itself
 * is owned by the caller and is never cleared on failure, so `retry` just
 * re-invokes `run` against the same File.
 */
export function useUploadTask(run: (file: File, onProgress: (loaded: number, total: number) => void) => Promise<void>) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [error, setError] = useState('');
  const sampleRef = useRef<{ time: number; loaded: number } | null>(null);
  const fileRef = useRef<File | null>(null);

  const onProgress = useCallback((loaded: number, total: number) => {
    if (total <= 0) return;
    setProgress(Math.round((loaded / total) * 100));
    const now = Date.now();
    const sample = sampleRef.current;
    if (sample) {
      const elapsedSec = (now - sample.time) / 1000;
      const deltaBytes = loaded - sample.loaded;
      if (elapsedSec > 0.15 && deltaBytes > 0) {
        const bytesPerSec = deltaBytes / elapsedSec;
        setEtaSeconds(Math.max(0, (total - loaded) / bytesPerSec));
        sampleRef.current = { time: now, loaded };
      }
    } else {
      sampleRef.current = { time: now, loaded };
    }
  }, []);

  const start = useCallback(async (file: File) => {
    fileRef.current = file;
    setStatus('uploading');
    setProgress(0);
    setEtaSeconds(null);
    setError('');
    sampleRef.current = { time: Date.now(), loaded: 0 };
    try {
      await run(file, onProgress);
      setStatus('done');
      setProgress(100);
      setEtaSeconds(0);
    } catch (err: any) {
      setStatus('error');
      setError(err?.message || 'Upload failed. Please try again.');
    }
  }, [run, onProgress]);

  const retry = useCallback(() => {
    if (fileRef.current) start(fileRef.current);
  }, [start]);

  const reset = useCallback(() => {
    fileRef.current = null;
    setStatus('idle');
    setProgress(0);
    setEtaSeconds(null);
    setError('');
  }, []);

  return { status, progress, etaSeconds, error, start, retry, reset };
}

/**
 * XHR FormData upload with real progress — for the one surface (Backup
 * Restore) that already posts a raw File via multipart/form-data instead of
 * base64 JSON. Resolves the parsed JSON body; rejects with the server's
 * error message (or a generic one) on a non-2xx response or network error.
 */
export function uploadFormData(url: string, formData: FormData, onProgress: (loaded: number, total: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data?.error || `Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading. Please try again.'));
    xhr.send(formData);
  });
}

/**
 * Lighter-weight drag reactivity for a spot that's already a compact toolbar
 * button rather than a full drop-zone box (e.g. a "Upload CSV" button) —
 * wire `dragHandlers` onto the element and use `isDragOver` to drive the
 * same border/glow/copy-shift signals without adopting FileDropzone's layout.
 */
export function useDropTarget(onFilesDropped: (files: File[]) => void, disabled?: boolean) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counter = useRef(0);

  return {
    isDragOver,
    dragHandlers: {
      onDragEnter: (e: DragEvent) => {
        e.preventDefault();
        if (disabled) return;
        counter.current += 1;
        setIsDragOver(true);
      },
      onDragOver: (e: DragEvent) => e.preventDefault(),
      onDragLeave: (e: DragEvent) => {
        e.preventDefault();
        counter.current = Math.max(0, counter.current - 1);
        if (counter.current === 0) setIsDragOver(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        counter.current = 0;
        setIsDragOver(false);
        if (disabled) return;
        if (e.dataTransfer.files?.length) onFilesDropped(Array.from(e.dataTransfer.files));
      },
    },
  };
}

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  compact?: boolean;
  /** Forwarded to the hidden input's `capture` attribute — on mobile/tablet
   *  browsers this opens the device camera directly instead of only the file
   *  picker (only meaningful paired with an image `accept`). 'user' for the
   *  front-facing camera, 'environment' for the rear camera, or `true` to
   *  let the browser pick a default facing mode. */
  capture?: boolean | 'user' | 'environment';
}

/** The drag-and-drop target. Reacts to a file being dragged over it with three
 * simultaneous signals — border, glow, and copy shift — before the drop even
 * happens, instead of sitting there giving no sign it's interactive. */
export function FileDropzone({ onFilesSelected, accept, multiple, disabled, label = 'Click to upload or drag and drop', hint, compact, capture }: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFilesSelected(Array.from(list));
  };

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragEnter={(e) => {
        e.preventDefault();
        if (disabled) return;
        dragCounter.current += 1;
        setIsDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        if (dragCounter.current === 0) setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragOver(false);
        if (disabled) return;
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex flex-col items-center justify-center text-center rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-150 ${compact ? 'p-4 gap-1.5' : 'p-8 gap-2.5'} ${
        disabled
          ? 'border-theme-border/30 opacity-50 cursor-not-allowed'
          : isDragOver
            ? 'border-accent bg-accent/10 shadow-lg shadow-accent/20 ring-4 ring-accent/10 scale-[1.01]'
            : 'border-theme-border/40 hover:border-accent/50 hover:bg-theme-border/10'
      }`}
    >
      <UploadCloud className={`${compact ? 'h-5 w-5' : 'h-7 w-7'} transition-colors ${isDragOver ? 'text-accent' : 'text-theme-text-secondary'}`} />
      <p className={`font-semibold transition-colors ${compact ? 'text-xs' : 'text-sm'} ${isDragOver ? 'text-accent' : 'text-theme-text-primary'}`}>
        {isDragOver ? 'Drop it here' : label}
      </p>
      {hint && <p className="text-[10px] text-theme-text-secondary">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        capture={capture}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
    </div>
  );
}

interface FilePreviewRowProps {
  file: File;
  status?: UploadStatus;
  progress?: number;
  etaSeconds?: number | null;
  error?: string;
  onRetry?: () => void;
  onRemove?: () => void;
}

/** One selected file's proof-of-receipt row: thumbnail, type, size — never
 * just a filename — plus its own progress/retry, independent of any other
 * file shown alongside it. */
export function FilePreviewRow({ file, status = 'idle', progress = 0, etaSeconds = null, error, onRetry, onRemove }: FilePreviewRowProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isImage = file.type.startsWith('image/');

  useEffect(() => {
    if (!isImage) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  const Icon = iconForFile(file);

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${status === 'error' ? 'border-danger/40 bg-danger/5' : 'border-theme-border/30 bg-theme-background/20'}`}>
      <div className="h-11 w-11 shrink-0 rounded-lg overflow-hidden flex items-center justify-center bg-theme-border/20 text-theme-text-secondary">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-theme-text-primary truncate">{file.name}</p>
          {status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
          {onRemove && status !== 'uploading' && (
            <button
              type="button"
              onClick={onRemove}
              className="h-5 w-5 flex items-center justify-center rounded-md text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-border/30 transition-all cursor-pointer shrink-0"
              title="Remove file"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-theme-text-secondary">
          {(file.type || 'unknown type').split('/').pop()?.toUpperCase()} · {formatFileSize(file.size)}
        </p>

        {status === 'uploading' && (
          <div className="space-y-0.5 pt-0.5">
            <div className="h-1.5 rounded-full bg-theme-border/30 overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex items-center justify-between text-[10px] text-theme-text-secondary">
              <span>{progress}%</span>
              {etaSeconds !== null && <span>{formatEta(etaSeconds)}</span>}
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="flex items-center gap-1 text-[10px] text-danger">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {error || 'Upload failed.'}
            </span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline cursor-pointer shrink-0"
              >
                <RotateCw className="h-3 w-3" />
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
