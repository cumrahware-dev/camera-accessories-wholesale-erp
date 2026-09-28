'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Bot, User as UserIcon, Clock, Database } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  periodLabel?: string;
  dataSource?: string;
  isError?: boolean;
}

export default function SalesAssistantPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        "Hi, I'm the Sales AI Assistant. Ask me about revenue, top customers or products, outstanding invoices, inventory value, low stock, or sales trends — every answer is computed live from your ERP data.",
    },
  ]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/ai/sales-assistant')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.suggestedQuestions) setSuggestedQuestions(data.suggestedQuestions);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isThinking]);

  const askQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isThinking) return;

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: trimmed }]);
    setInput('');
    setIsThinking(true);

    try {
      const res = await fetch('/api/ai/sales-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get an answer');

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: data.answer.answerText,
          periodLabel: data.answer.periodLabel,
          dataSource: data.answer.dataSource,
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: err.message || 'Something went wrong.', isError: true },
      ]);
      toast({ title: 'Assistant error', description: err.message, variant: 'error' });
    } finally {
      setIsThinking(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    askQuestion(input);
  };

  return (
    <div className="flex flex-col gap-6 pb-16 max-w-4xl mx-auto">
      <PageHeader
        title="Sales AI Assistant"
        description="Ask questions about revenue, customers, products, and inventory — answered live from your ERP data."
      />

      <Card className="flex flex-col h-[70vh] overflow-hidden p-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div
                className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${
                  m.role === 'user' ? 'bg-primary text-white' : 'bg-primary-soft text-primary'
                }`}
              >
                {m.role === 'user' ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>
              <div className={`flex flex-col gap-1.5 max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-line leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-primary text-white rounded-tr-sm'
                      : m.isError
                      ? 'bg-danger-soft border border-danger-border text-danger rounded-tl-sm'
                      : 'bg-surface border border-line text-ink rounded-tl-sm'
                  }`}
                >
                  {m.text}
                </div>
                {(m.periodLabel || m.dataSource) && (
                  <div className="flex items-center gap-3 px-1 text-[10px] text-muted">
                    {m.periodLabel && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {m.periodLabel}
                      </span>
                    )}
                    {m.dataSource && (
                      <span className="flex items-center gap-1">
                        <Database className="h-3 w-3" /> {m.dataSource}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="flex gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-primary-soft text-primary flex items-center justify-center">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-surface border border-line text-xs text-muted">
                Analyzing live ERP data...
              </div>
            </div>
          )}
        </div>

        {suggestedQuestions.length > 0 && messages.length <= 1 && (
          <div className="px-4 sm:px-6 pb-3 flex flex-wrap gap-2 border-t border-line-soft pt-3">
            {suggestedQuestions.slice(0, 6).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => askQuestion(q)}
                className="px-3 py-1.5 rounded-full border border-line bg-white hover:bg-surface text-xs text-ink-secondary hover:text-ink transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2 p-3 sm:p-4 border-t border-line bg-white">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about sales, customers, products, or inventory..."
            disabled={isThinking}
            className="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm text-ink placeholder-muted focus:bg-white focus:border-primary focus:outline-none disabled:opacity-60"
          />
          <Button type="submit" disabled={isThinking || !input.trim()} iconLeft={<Send className="h-4 w-4" />}>
            <span className="hidden sm:inline">Ask</span>
          </Button>
        </form>
      </Card>

      <div className="flex items-start gap-2 text-[11px] text-muted px-1">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span>
          Answers are computed directly from your ERP's live data and scoped to what your account is authorized to
          see. Figures are never estimated or generated — each answer states its data source and time period.
        </span>
      </div>
    </div>
  );
}
