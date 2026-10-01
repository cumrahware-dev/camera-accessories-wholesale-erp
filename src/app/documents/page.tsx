'use client';

import React, { useState, useEffect } from 'react';
import {
  FolderLock,
  UploadCloud,
  FileText,
  ExternalLink,
  Download,
  Trash2,
  Image as ImageIcon,
  AlertCircle,
  X,
  Sparkles,
} from 'lucide-react';
import { formatFileSize, formatDateTime } from '@/lib/utils';
import { CloudDocument, DocumentCategory } from '@/types/erp';
import CloudinaryUploadModal from '@/components/documents/CloudinaryUploadModal';
import OcrExtractionModal from '@/components/documents/OcrExtractionModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/Input';
import { Toolbar, ToolbarGroup, FilterPillGroup } from '@/components/ui/FilterBar';
import { EmptyState } from '@/components/ui/EmptyState';

import { useDebounce } from '@/hooks/useDebounce';

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<CloudDocument[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Deep link from global search: /path?search=term pre-fills the list search box.
  useEffect(() => {
    const term = new URLSearchParams(window.location.search).get('search');
    if (term) setSearchQuery(term);
  }, []);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<CloudDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (query = '') => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (selectedCategory && selectedCategory !== 'ALL') params.set('category', selectedCategory);
      const res = await fetch(`/api/documents?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(Array.isArray(data) ? data : []);
      } else {
        setError('Failed to load documents');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(debouncedSearch);
  }, [debouncedSearch, selectedCategory]);

  const filteredDocs = documents.filter((doc) => {
    if (selectedCategory !== 'ALL' && doc.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        doc.title.toLowerCase().includes(q) ||
        doc.fileName.toLowerCase().includes(q) ||
        doc.relatedEntityLabel.toLowerCase().includes(q) ||
        doc.tags?.some((t) => t.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to remove this document from the hub?')) {
      try {
        const res = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Unable to delete the document');
        }
        setPreviewDoc((current) => (current?.id === id ? null : current));
        await loadData();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Unable to delete document');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-muted text-xs font-medium">Loading Cloudinary document repository...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Documents"
        description="One place for every commercial document — AWBs, invoices, proformas, and certificates."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              iconLeft={<Sparkles className="h-4 w-4 text-primary" />}
              onClick={() => setIsAiModalOpen(true)}
            >
              AI PDF Extraction
            </Button>
            <Button iconLeft={<UploadCloud className="h-4 w-4" />} onClick={() => setIsUploadOpen(true)}>
              Upload Document
            </Button>
          </div>
        }
      />

      {error && (
        <div className="p-3 rounded-2xl bg-danger-soft border border-danger-border text-danger text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filters + Search */}
      <Toolbar>
        <ToolbarGroup>
          <FilterPillGroup
            value={selectedCategory}
            onChange={setSelectedCategory}
            options={[
              { label: 'All Documents', value: 'ALL' },
              { label: 'Airway Bills', value: 'AIRWAY_BILL' },
              { label: 'Tax Invoices', value: 'TAX_INVOICE' },
              { label: 'Proformas', value: 'PROFORMA' },
              { label: 'Packing Lists', value: 'PACKING_LIST' },
              { label: 'Certificates', value: 'CERTIFICATE' },
              { label: 'Other', value: 'OTHER' },
            ]}
          />
        </ToolbarGroup>
        <SearchInput
          placeholder="Search title, filename, SKU, AWB or customer..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="w-full lg:w-72"
        />
      </Toolbar>

      {/* Documents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDocs.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-line bg-white">
            <EmptyState icon={FolderLock} title="No documents found" description="No documents match your search or filter." />
          </div>
        ) : (
          filteredDocs.map((doc) => {
            const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(doc.fileFormat.toLowerCase());

            return (
              <Card
                key={doc.id}
                onClick={() => setPreviewDoc(doc)}
                className="p-4 flex flex-col justify-between cursor-pointer hover:border-primary/40 transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <Badge tone="info">{doc.category.replace(/_/g, ' ')}</Badge>
                    <button
                      onClick={(e) => handleDelete(doc.id, e)}
                      title="Delete Document"
                      className="text-muted hover:text-danger p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-surface-muted border border-line flex items-center justify-center shrink-0 text-primary">
                      {isImage ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs font-bold text-ink group-hover:text-primary line-clamp-1">
                        {doc.title}
                      </h3>
                      <p className="text-[11px] text-muted font-mono mt-0.5 truncate">{doc.fileName}</p>
                    </div>
                  </div>

                  <div className="mt-3 p-2 rounded bg-surface border border-line-soft text-[11px] text-ink-secondary">
                    <span className="text-muted block text-[10px]">Linked Entity:</span>
                    <span className="font-medium truncate block">{doc.relatedEntityLabel || doc.relatedEntityType}</span>
                  </div>
                </div>

                <div className="mt-4 pt-2.5 border-t border-line-soft flex items-center justify-between text-[10px] font-mono text-muted">
                  <span>{formatFileSize(doc.fileSize)}</span>
                  <span>{formatDateTime(doc.uploadedAt)}</span>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <CloudinaryUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploaded={() => loadData()}
      />

      <OcrExtractionModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        onSuccess={() => loadData()}
      />

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-fade-in">
          <div className="relative w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain max-w-2xl rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">{previewDoc.title}</h3>
                <p className="text-[11px] font-mono text-muted">{previewDoc.fileName}</p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={previewDoc.cloudinaryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 h-9 px-3.5 rounded-full bg-primary hover:bg-primary-hover text-white text-xs font-semibold"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download</span>
                </a>
                <IconButton label="Close preview" onClick={() => setPreviewDoc(null)}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
            </div>

            <div className="p-6 max-h-[65vh] overflow-y-auto flex flex-col items-center justify-center bg-surface-muted">
              {['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(previewDoc.fileFormat.toLowerCase()) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewDoc.cloudinaryUrl}
                  alt={previewDoc.title}
                  className="max-h-[50vh] max-w-full rounded-xl object-contain border border-line"
                />
              ) : (
                <div className="text-center py-8 space-y-3">
                  <FileText className="h-12 w-12 text-primary mx-auto" />
                  <div className="text-xs font-bold text-ink">{previewDoc.fileName}</div>
                  <a
                    href={previewDoc.cloudinaryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 h-9 px-4 rounded-full bg-primary text-white text-xs font-semibold"
                  >
                    Open Document Link <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
