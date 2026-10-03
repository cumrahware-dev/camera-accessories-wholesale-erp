'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, Link as LinkIcon, Image as ImageIcon, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageUploadFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  previewHeightClass?: string;
  fallbackIcon?: React.ReactNode;
}

export default function ImageUploadField({
  value,
  onChange,
  label = 'Image',
  placeholder = 'Paste an image URL',
}: ImageUploadFieldProps) {
  const [mode, setMode] = useState<'UPLOAD' | 'URL'>(
    value && value.startsWith('http') && !value.startsWith('data:') ? 'URL' : 'UPLOAD'
  );
  const [isDragging, setIsDragging] = useState(false);
  const [urlInput, setUrlInput] = useState(value && !value.startsWith('data:') ? value : '');
  const [previewFailed, setPreviewFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewFailed(false);
      onChange(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleRemove = () => {
    onChange('');
    setUrlInput('');
    setPreviewFailed(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const tabClasses = (active: boolean) =>
    cn(
      'flex min-h-[40px] items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors md:min-h-0 md:px-2.5 md:text-[11px]',
      active ? 'bg-primary text-white' : 'text-muted hover:text-ink'
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-ink">{label}</label>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-muted p-0.5">
          <button type="button" onClick={() => setMode('UPLOAD')} className={tabClasses(mode === 'UPLOAD')}>
            <UploadCloud className="h-3 w-3" />
            <span>Upload</span>
          </button>
          <button type="button" onClick={() => setMode('URL')} className={tabClasses(mode === 'URL')}>
            <LinkIcon className="h-3 w-3" />
            <span>URL</span>
          </button>
        </div>
      </div>

      {mode === 'UPLOAD' ? (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="hidden"
          />
          {!value && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'rounded-lg border border-dashed p-5 text-center cursor-pointer transition-colors',
                isDragging ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary bg-surface-muted'
              )}
            >
              <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-muted border border-line">
                <UploadCloud className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-ink">Click to browse or drag &amp; drop</p>
              <p className="text-[11px] text-muted mt-0.5">PNG, JPG or WebP, up to 10MB</p>
            </div>
          )}
        </div>
      ) : (
        <input
          type="url"
          placeholder={placeholder}
          value={urlInput}
          onChange={(e) => {
            setUrlInput(e.target.value);
            setPreviewFailed(false);
            onChange(e.target.value);
          }}
          className="w-full h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-ring"
        />
      )}

      {value && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-line bg-surface-muted flex items-center justify-center">
            {previewFailed ? (
              <ImageIcon className="h-5 w-5 text-muted" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value}
                alt="Preview"
                onError={() => setPreviewFailed(true)}
                className="h-full w-full object-cover"
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" />
              <span>{previewFailed ? 'Image set (preview unavailable)' : 'Image attached'}</span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
              {value.startsWith('data:') ? 'Uploaded file' : value}
            </p>
            <div className="mt-1 flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] px-1 text-xs font-medium text-primary hover:underline md:min-h-0 md:text-[11px]"
              >
                Change
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="min-h-[44px] px-1 text-xs font-medium text-danger hover:underline md:min-h-0 md:text-[11px]"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
