'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { Sparkles, CheckCircle2, AlertCircle, X, ExternalLink, Loader2, ArrowRight } from 'lucide-react';
import { ExtractedDocumentData } from '@/lib/ocr-types';
import { useToast } from '@/components/ui/Toast';

export interface ActiveExtraction {
  id: string;
  fileName: string;
  fileSize: number;
  status: 'analyzing' | 'completed' | 'error';
  progressLabel: string;
  startTime: number;
  result?: {
    extractedData: ExtractedDocumentData;
    document: any;
    cloudinary: any;
  };
  error?: string;
}

interface ExtractionContextType {
  activeExtractions: ActiveExtraction[];
  startExtraction: (fileData: string, fileName: string, category?: string) => Promise<ActiveExtraction>;
  dismissExtraction: (id: string) => void;
  reviewExtraction: (extraction: ActiveExtraction) => void;
  pendingReviewExtraction: ActiveExtraction | null;
  clearPendingReview: () => void;
}

const ExtractionContext = createContext<ExtractionContextType | null>(null);

async function dataUriToFormData(dataUri: string, fileName: string): Promise<FormData> {
  const blob = await (await fetch(dataUri)).blob();
  const form = new FormData();
  form.append('file', blob, fileName);
  return form;
}

export function ExtractionProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [activeExtractions, setActiveExtractions] = useState<ActiveExtraction[]>([]);
  const [pendingReviewExtraction, setPendingReviewExtraction] = useState<ActiveExtraction | null>(null);

  const dismissExtraction = useCallback((id: string) => {
    setActiveExtractions((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearPendingReview = useCallback(() => {
    setPendingReviewExtraction(null);
  }, []);

  const reviewExtraction = useCallback((extraction: ActiveExtraction) => {
    setPendingReviewExtraction(extraction);
  }, []);

  const startExtraction = useCallback(
    async (fileData: string, fileName: string, category = 'PROFORMA'): Promise<ActiveExtraction> => {
      const id = `extract-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newExtraction: ActiveExtraction = {
        id,
        fileName,
        fileSize: Math.round((fileData.length * 3) / 4),
        status: 'analyzing',
        progressLabel: 'Uploading & reading document...',
        startTime: Date.now(),
      };

      setActiveExtractions((prev) => [newExtraction, ...prev]);

      // Fire non-blocking asynchronous request (multipart: the server forwards the file to the OCR service)
      dataUriToFormData(fileData, fileName)
        .then((form) => fetch('/api/ocr', { method: 'POST', body: form }))
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Document extraction failed');
          }

          setActiveExtractions((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: 'completed',
                    progressLabel: 'Extraction complete! Ready for review.',
                    result: {
                      extractedData: data.extractedData,
                      document: data.document,
                      cloudinary: data.cloudinary,
                    },
                  }
                : item
            )
          );

          toast({
            title: 'PDF Extracted Successfully',
            description: `"${fileName}" read. Click to review & save.`,
            variant: 'success',
          });
        })
        .catch((err: any) => {
          const errorMsg = err?.message || 'Error occurred during extraction';
          setActiveExtractions((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: 'error',
                    progressLabel: 'Extraction failed',
                    error: errorMsg,
                  }
                : item
            )
          );

          toast({
            title: 'PDF Extraction Failed',
            description: `Could not process "${fileName}": ${errorMsg}`,
            variant: 'error',
          });
        });

      return newExtraction;
    },
    [toast]
  );

  return (
    <ExtractionContext.Provider
      value={{
        activeExtractions,
        startExtraction,
        dismissExtraction,
        reviewExtraction,
        pendingReviewExtraction,
        clearPendingReview,
      }}
    >
      {children}
      <ExtractionProgressWidget />
    </ExtractionContext.Provider>
  );
}

export function useExtraction() {
  const context = useContext(ExtractionContext);
  if (!context) {
    throw new Error('useExtraction must be used within an ExtractionProvider');
  }
  return context;
}

/**
 * Floating, non-blocking asynchronous extraction widget
 * Displayed in the bottom-right corner of the ERP
 */
function ExtractionProgressWidget() {
  const { activeExtractions, dismissExtraction, reviewExtraction } = useExtraction();

  if (activeExtractions.length === 0) return null;

  return (
    <div className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] md:bottom-5 right-3 md:right-5 left-3 md:left-auto z-50 flex flex-col gap-2 md:max-w-sm md:w-full pointer-events-auto shadow-2xl animate-in slide-in-from-bottom-5">
      {activeExtractions.map((task) => (
        <div
          key={task.id}
          className={`p-3.5 rounded-xl border backdrop-blur-md transition-all ${
            task.status === 'analyzing'
              ? 'bg-slate-900/95 text-white border-slate-700 shadow-sky-950/20'
              : task.status === 'completed'
              ? 'bg-emerald-950/95 text-emerald-50 border-emerald-700/60 shadow-emerald-950/30'
              : 'bg-rose-950/95 text-rose-50 border-rose-700/60 shadow-rose-950/30'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {task.status === 'analyzing' && (
                <Loader2 className="h-4 w-4 text-sky-400 animate-spin shrink-0" />
              )}
              {task.status === 'completed' && (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              )}
              {task.status === 'error' && (
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{task.fileName}</p>
                <p className="text-[11px] opacity-80 truncate">{task.progressLabel}</p>
              </div>
            </div>
            <button
              onClick={() => dismissExtraction(task.id)}
              className="text-white/60 hover:text-white p-0.5 rounded transition-colors shrink-0"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {task.status === 'completed' && task.result && (
            <div className="mt-2.5 pt-2 border-t border-emerald-800/60 flex items-center justify-between">
              <span className="text-[11px] text-emerald-300 font-medium">
                {task.result.extractedData.lineItems?.length || 0} line items extracted
              </span>
              <button
                onClick={() => {
                  reviewExtraction(task);
                  dismissExtraction(task.id);
                }}
                className="px-2.5 py-1 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg flex items-center gap-1 transition-colors"
              >
                Review & Save
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}

          {task.status === 'analyzing' && (
            <div className="mt-2 pt-1.5 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
              <span>Processing asynchronously</span>
              <span className="font-mono">ERP stays active</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
