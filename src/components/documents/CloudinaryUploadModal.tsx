'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, Camera, FileText, Image as ImageIcon, X } from 'lucide-react';
import { DOCUMENT_CATEGORIES } from '@/lib/documents/categories';
import { DocumentCategory, RelatedEntityType } from '@/types/erp';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';

interface CloudinaryUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The stored document, so a caller can attach it to the record it belongs to (e.g. a shipment's airway bill). */
  onUploaded?: (document?: { id: string; fileName: string; cloudinaryUrl: string }) => void;
  defaultCategory?: DocumentCategory;
  defaultEntityType?: RelatedEntityType;
  defaultEntityId?: string;
  defaultEntityLabel?: string;
}

// Only the categories documents are actually stored under. The list used to offer several more (packing list,
// shipping document, purchase invoice, warranty, certificate), and choosing any of them failed the upload.
const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ label: c.label, value: c.value }));

const ENTITY_OPTIONS = [
  { label: 'Shipment', value: 'SHIPMENT' },
  { label: 'Tax Invoice', value: 'INVOICE' },
  { label: 'Proforma', value: 'PROFORMA' },
  { label: 'Customer', value: 'CUSTOMER' },
  { label: 'Depot', value: 'DEPOT' },
  { label: 'Product', value: 'PRODUCT' },
  { label: 'Supplier', value: 'SUPPLIER' },
];

function formatBytes(bytes: number) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CloudinaryUploadModal({
  isOpen,
  onClose,
  onUploaded,
  defaultCategory = 'AIRWAY_BILL',
  defaultEntityType = 'SHIPMENT',
  defaultEntityId = '',
  defaultEntityLabel = '',
}: CloudinaryUploadModalProps) {
  const [fileData, setFileData] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);
  const [relatedEntityType, setRelatedEntityType] = useState<RelatedEntityType>(defaultEntityType);
  const [relatedEntityId, setRelatedEntityId] = useState(defaultEntityId);
  const [relatedEntityLabel, setRelatedEntityLabel] = useState(defaultEntityLabel);
  const [tags, setTags] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setFileSize(file.size);
    if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ''));

    const reader = new FileReader();
    reader.onload = (event) => setFileData(event.target?.result as string);
    reader.readAsDataURL(file);
  };

  const resetFile = () => {
    setFileData(null);
    setFileName('');
    setFileSize(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileData) {
      setErrorMessage('Select a file or take a photo first.');
      return;
    }

    setIsUploading(true);
    setErrorMessage('');

    try {
      const res = await fetch('/api/cloudinary/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileData,
          fileName,
          title: title || fileName,
          category,
          relatedEntityType,
          relatedEntityId,
          relatedEntityLabel: relatedEntityLabel || `${relatedEntityType} #${relatedEntityId}`,
          tags: tags ? tags.split(',').map((t) => t.trim()) : [category],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      if (onUploaded) onUploaded(data.document);
      resetFile();
      setTitle('');
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const isImage = fileData?.startsWith('data:image');

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="xl"
      title="Upload Document"
      description="Attach a file to an invoice, shipment, customer, or product record."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button type="submit" form="upload-form" loading={isUploading} iconLeft={!isUploading ? <UploadCloud className="h-4 w-4" /> : undefined}>
            Upload
          </Button>
        </>
      }
    >
      <form id="upload-form" onSubmit={handleUpload} className="flex flex-col gap-4">
        {errorMessage && (
          <div className="rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
            {errorMessage}
          </div>
        )}

        <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" accept="image/*,application/pdf" />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />

        {!fileData ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface-muted p-6 text-center hover:border-primary transition-colors"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted">
                <UploadCloud className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium text-ink">Choose a file</span>
              <span className="text-[11px] text-muted">PDF or image, up to 10MB</span>
            </button>

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface-muted p-6 text-center hover:border-primary transition-colors"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted">
                <Camera className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium text-ink">Take a photo</span>
              <span className="text-[11px] text-muted">Use the device camera</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-muted">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileData} alt="Preview" className="h-full w-full object-cover" />
              ) : (
                <FileText className="h-5 w-5 text-muted" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{fileName}</div>
              <div className="text-xs text-muted mt-0.5">{formatBytes(fileSize)}</div>
            </div>
            <button
              type="button"
              onClick={resetFile}
              className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-ink"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <Input label="Document Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. AWB for INV-2026-0001" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Category"
            options={CATEGORY_OPTIONS}
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          />
          <Select
            label="Related To"
            options={ENTITY_OPTIONS}
            value={relatedEntityType}
            onChange={(e) => setRelatedEntityType(e.target.value as RelatedEntityType)}
          />
        </div>

        <Input
          label="Related Record"
          value={relatedEntityLabel}
          onChange={(e) => setRelatedEntityLabel(e.target.value)}
          placeholder="e.g. INV-2026-0001"
        />
        <Input
          label="Tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Comma separated, e.g. urgent, customs"
        />
      </form>
    </Modal>
  );
}
