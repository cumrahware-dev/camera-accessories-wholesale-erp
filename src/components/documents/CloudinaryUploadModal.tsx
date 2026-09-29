'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, Camera, FileText, Image as ImageIcon, X } from 'lucide-react';
import { CloudDocument, DocumentCategory, RelatedEntityType } from '@/types/erp';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';

interface CloudinaryUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded?: () => void;
  defaultCategory?: DocumentCategory;
  defaultEntityType?: RelatedEntityType;
  defaultEntityId?: string;
  defaultEntityLabel?: string;
  /** When set, the modal replaces this document's file in place instead of creating a new one. */
  replaceDocument?: CloudDocument | null;
}

const CATEGORY_OPTIONS = [
  { label: 'Airway Bill (AWB)', value: 'AIRWAY_BILL' },
  { label: 'Tax Invoice', value: 'TAX_INVOICE' },
  { label: 'Proforma Invoice', value: 'PROFORMA' },
  { label: 'Packing List / Inspection', value: 'PACKING_LIST' },
  { label: 'Shipping Document', value: 'SHIPPING_DOCUMENT' },
  { label: 'Purchase Invoice', value: 'PURCHASE_INVOICE' },
  { label: 'Customs / Export Doc', value: 'CUSTOMS_DOC' },
  { label: 'Warranty Document', value: 'WARRANTY_DOCUMENT' },
  { label: 'Certificate of Origin', value: 'CERTIFICATE' },
  { label: 'Other Business Document', value: 'OTHER' },
];

const ENTITY_OPTIONS = [
  { label: 'Shipment', value: 'SHIPMENT' },
  { label: 'Tax Invoice', value: 'INVOICE' },
  { label: 'Proforma', value: 'PROFORMA' },
  { label: 'Customer', value: 'CUSTOMER' },
  { label: 'Depot', value: 'DEPOT' },
  { label: 'Product', value: 'PRODUCT' },
  { label: 'Supplier', value: 'SUPPLIER' },
];

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

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
  replaceDocument = null,
}: CloudinaryUploadModalProps) {
  const isReplaceMode = Boolean(replaceDocument);
  const [fileData, setFileData] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [title, setTitle] = useState(replaceDocument?.title || '');
  const [category, setCategory] = useState<DocumentCategory>(replaceDocument?.category || defaultCategory);
  const [relatedEntityType, setRelatedEntityType] = useState<RelatedEntityType>(
    replaceDocument?.relatedEntityType || defaultEntityType
  );
  const [relatedEntityId, setRelatedEntityId] = useState(replaceDocument?.relatedEntityId || defaultEntityId);
  const [relatedEntityLabel, setRelatedEntityLabel] = useState(replaceDocument?.relatedEntityLabel || defaultEntityLabel);
  const [tags, setTags] = useState((replaceDocument?.tags || []).join(', '));
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setErrorMessage(`"${file.name}" is ${formatBytes(file.size)} — the maximum file size is 10MB.`);
      e.target.value = '';
      return;
    }

    setErrorMessage('');
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

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileData) {
      setErrorMessage('Select a file or take a photo first.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setErrorMessage('');

    const payload = {
      fileData,
      fileName,
      title: title || fileName,
      category,
      relatedEntityType,
      relatedEntityId,
      relatedEntityLabel: relatedEntityLabel || `${relatedEntityType} #${relatedEntityId}`,
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [category],
      ...(replaceDocument ? { replaceDocumentId: replaceDocument.id } : {}),
    };

    // Use XHR (not fetch) so we can report real upload progress for the
    // base64 payload, which can be a few MB for scanned documents.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/cloudinary/upload');
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {}

      if (xhr.status < 200 || xhr.status >= 300) {
        setErrorMessage(data.error || 'Upload failed. Please try again.');
        return;
      }

      if (onUploaded) onUploaded();
      resetFile();
      setTitle('');
      onClose();
    };

    xhr.onerror = () => {
      setIsUploading(false);
      setErrorMessage('Upload failed. Check your connection and try again.');
    };

    xhr.send(JSON.stringify(payload));
  };

  const isImage = fileData?.startsWith('data:image');

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="xl"
      title={isReplaceMode ? `Replace "${replaceDocument?.title}"` : 'Upload Document'}
      description={
        isReplaceMode
          ? 'Upload a new file to replace this document. Its category and linked record stay the same.'
          : 'Attach a file to an invoice, shipment, customer, or product record.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button type="submit" form="upload-form" loading={isUploading} iconLeft={!isUploading ? <UploadCloud className="h-4 w-4" /> : undefined}>
            {isReplaceMode ? 'Replace File' : 'Upload'}
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

        <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" accept="image/png,image/jpeg,image/jpg,application/pdf" />
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
              <span className="text-[11px] text-muted">PDF, PNG, or JPG, up to 10MB</span>
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
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center gap-3">
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
              {!isUploading && (
                <button
                  type="button"
                  onClick={resetFile}
                  className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-ink"
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {isUploading && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-surface-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-muted w-9 text-right">{uploadProgress}%</span>
              </div>
            )}
          </div>
        )}

        <Input label="Document Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. AWB for INV-2026-0001" />

        {!isReplaceMode && (
          <>
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
          </>
        )}
      </form>
    </Modal>
  );
}
