import { formatWordCount } from '@tpr/core';
import { useEffect, useRef, useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

interface WordCountProps {
  ids: readonly string[];
  className?: string;
}

interface CountState {
  key: string;
  sum: number | null;
  error: boolean;
}

const visibleCallbacks = new WeakMap<Element, () => void>();
let sharedObserver: IntersectionObserver | null = null;

/** 列表里可能同时有几十个字数标签，共用一个 observer，滚到附近才发查询。 */
function observeOnce(node: Element, callback: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback();
    return () => undefined;
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const run = visibleCallbacks.get(entry.target);
          if (!run) continue;
          visibleCallbacks.delete(entry.target);
          sharedObserver?.unobserve(entry.target);
          run();
        }
      },
      { rootMargin: '200px' },
    );
  }
  visibleCallbacks.set(node, callback);
  sharedObserver.observe(node);
  return () => {
    visibleCallbacks.delete(node);
    sharedObserver?.unobserve(node);
  };
}

/**
 * 文章/系列字数标签：懒加载、按数据库缓存。
 * 系列传全部 articleIds，文章传单个 id；不可见时不发查询。
 */
export function WordCount({ ids, className }: WordCountProps) {
  const services = useServices();
  const { snapshot } = useLibraryContext();
  const nodeRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const key = ids.join('\u0000');
  const databaseId = snapshot?.manifest.databaseId ?? '';
  const [state, setState] = useState<CountState>({ key: '', sum: null, error: false });

  useEffect(() => {
    if (key === '') {
      setVisible(true);
      return;
    }
    setVisible(false);
    const node = nodeRef.current;
    if (!node) return;
    return observeOnce(node, () => setVisible(true));
  }, [key]);

  useEffect(() => {
    if (!visible || !databaseId) return;
    const requested = key === '' ? [] : key.split('\u0000');
    let cancelled = false;
    setState({ key, sum: null, error: false });
    void services.library
      .wordCounts(requested)
      .then((counts) => {
        if (cancelled) return;
        let sum = 0;
        for (const id of requested) sum += counts.get(id) ?? 0;
        setState({ key, sum, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ key, sum: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [databaseId, key, services.library, visible]);

  let label = '';
  if (visible && key === '') label = '0 字';
  else if (visible && state.key === key && state.error) label = '—';
  else if (visible && state.key === key && state.sum !== null) label = `${formatWordCount(state.sum)} 字`;
  else if (visible) label = '…';

  return (
    <span ref={nodeRef} className={className} title={label ? `字数：${label}` : undefined}>
      {label}
    </span>
  );
}
