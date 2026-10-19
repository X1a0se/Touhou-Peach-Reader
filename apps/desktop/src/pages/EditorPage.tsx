import type { DBSnapshot, Editor } from '@tpr/core';
import { articleSeriesPosition } from '@tpr/core';
import type {
  ArticleMeta,
  CreditsEntry,
  ImageKind,
  Recommendation,
  Series,
  Tag,
  TagCategory,
} from '@tpr/schema';
import { normalizeName } from '@tpr/schema';
import { useEffect, useState } from 'react';
import { ArticleOrderPicker } from '../components/ArticleOrderPicker.js';
import { AuthorPicker } from '../components/AuthorPicker.js';
import { SeriesPicker } from '../components/SeriesPicker.js';
import { TagPicker } from '../components/TagPicker.js';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

type Tab = 'articles' | 'series' | 'authors' | 'tags' | 'images' | 'featured' | 'credits';

const TABS: { key: Tab; label: string }[] = [
  { key: 'articles', label: '文章' },
  { key: 'series', label: '系列' },
  { key: 'authors', label: '作者' },
  { key: 'tags', label: '标签' },
  { key: 'images', label: '图片' },
  { key: 'featured', label: '推荐语' },
  { key: 'credits', label: '鸣谢' },
];

const inputClass =
  'w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-[var(--ring)]';
const labelClass = 'text-xs font-medium text-muted-foreground';
const buttonClass =
  'rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50';
const primaryClass =
  'rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EditorPage() {
  const services = useServices();
  const { snapshot, refresh } = useLibraryContext();
  const [tab, setTab] = useState<Tab>('articles');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!snapshot) {
    return <p className="text-sm text-muted-foreground">还没有导入数据库，先在首页拖入一个 .tpr。</p>;
  }

  const run = async (action: () => Promise<void>, done: string): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(done);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-[0.68rem] font-semibold tracking-[0.2em] text-accent uppercase">写作</p>
        <h2 className="text-2xl font-semibold tracking-tight">编辑器</h2>
        <p className="text-xs text-muted-foreground">
          所有改动立即写入 workspace/{'{databaseId'}/，重启后保留；每次保存前都会跑一遍校验。
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setTab(item.key);
              setError(null);
              setNotice(null);
            }}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              tab === item.key
                ? 'bg-accent-soft font-medium text-accent ring-1 ring-[var(--ring)]'
                : 'text-muted-foreground hover:bg-surface-strong hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'articles' ? <ArticlesPanel snapshot={snapshot} run={run} editor={services.editor} /> : null}
      {tab === 'series' ? <SeriesPanel snapshot={snapshot} run={run} editor={services.editor} /> : null}
      {tab === 'authors' ? <AuthorsPanel snapshot={snapshot} run={run} editor={services.editor} /> : null}
      {tab === 'tags' ? <TagsPanel snapshot={snapshot} run={run} editor={services.editor} /> : null}
      {tab === 'images' ? <ImagesPanel snapshot={snapshot} run={run} editor={services.editor} /> : null}
      {tab === 'featured' ? <FeaturedPanel snapshot={snapshot} run={run} editor={services.editor} /> : null}
      {tab === 'credits' ? <CreditsPanel snapshot={snapshot} run={run} editor={services.editor} /> : null}
    </section>
  );
}

type Run = (action: () => Promise<void>, done: string) => Promise<void>;

function PanelList<T>({
  items,
  selectedId,
  onSelect,
  render,
}: {
  items: T[];
  selectedId: string | null;
  onSelect(item: T): void;
  render(item: T): React.ReactNode;
}) {
  return (
    <ul className="flex max-h-[28rem] flex-col divide-y divide-border overflow-auto rounded-xl border border-border bg-surface/60">
      {items.map((item) => {
        const id = (item as { id: string }).id;
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-strong ${
                selectedId === id ? 'bg-muted' : ''
              }`}
            >
              {render(item)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PickerRow({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: { id: string; label: string }[];
  value: string[];
  onChange(next: string[]): void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelClass}>{title}</span>
      <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-auto rounded-md border border-border p-2">
        {options.length === 0 ? <span className="text-xs text-muted-foreground">还没有可选条目</span> : null}
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(option.id)}
              onChange={(event) =>
                onChange(event.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function ArticlesPanel({ snapshot, run, editor }: { snapshot: DBSnapshot; run: Run; editor: Editor }) {
  const library = useLibraryContext();
  const [editing, setEditing] = useState<ArticleMeta | null>(null);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className={primaryClass}
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          新建文章
        </button>
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-muted-foreground">
            多选导出（已选 {picked.size}）
          </summary>
          <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-auto">
            {snapshot.articles.map((article) => (
              <label key={article.id} className="flex items-center gap-2">
                <input type="checkbox" checked={picked.has(article.id)} onChange={() => togglePicked(article.id)} />
                <span className="truncate">{article.title}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className={`${buttonClass} mt-2 w-full`}
            disabled={picked.size === 0 || library.busy}
            onClick={() => void library.exportSelection({ articles: [...picked] })}
          >
            导出选中（{picked.size}）
          </button>
        </details>
        <PanelList
          items={snapshot.articles}
          selectedId={editing?.id ?? null}
          onSelect={(article) => {
            setCreating(false);
            setEditing(article);
          }}
          render={(article) => {
            const position = articleSeriesPosition(snapshot, article.id);
            return (
              <>
                <span className="truncate">{article.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {article.type === 'short' ? '短篇' : position ? `第 ${position.index} 篇` : '系列'}
                </span>
              </>
            );
          }}
        />
      </div>

      {creating || editing ? (
        <ArticleForm
          key={editing?.id ?? 'new'}
          snapshot={snapshot}
          initial={editing}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSubmit={async (draft) => {
            await run(async () => {
              await editor.saveArticle(draft);
            }, '文章已保存');
            setEditing(null);
            setCreating(false);
          }}
          onExport={editing ? () => void library.exportSelection({ articles: [editing.id] }) : undefined}
          onDelete={
            editing
              ? async () => {
                  if (!window.confirm(`删除《${editing.title}》？该操作会同时更新系列目录与精选。`)) return;
                  await run(async () => {
                    await editor.deleteArticle(editing.id);
                  }, '文章已删除');
                  setEditing(null);
                }
              : undefined
          }
        />
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          从左侧选择一篇文章，或新建一篇。
        </p>
      )}
    </div>
  );
}

function ArticleForm({
  snapshot,
  initial,
  onSubmit,
  onCancel,
  onDelete,
  onExport,
}: {
  snapshot: DBSnapshot;
  initial: ArticleMeta | null;
  onSubmit(draft: Parameters<Editor['saveArticle']>[0]): Promise<void>;
  onCancel(): void;
  onDelete?: (() => Promise<void>) | undefined;
  onExport?: (() => void) | undefined;
}) {
  const services = useServices();
  const { refresh } = useLibraryContext();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [content, setContent] = useState<string | null>(initial ? null : '');
  const [authorIds, setAuthorIds] = useState<string[]>(initial?.authorIds ?? []);
  const [translatorIds, setTranslatorIds] = useState<string[]>(initial?.translatorIds ?? []);
  const [characterTagIds, setCharacterTagIds] = useState<string[]>(initial?.characterTagIds ?? []);
  const [plotTagIds, setPlotTagIds] = useState<string[]>(initial?.plotTagIds ?? []);
  const [seriesId, setSeriesId] = useState(initial?.seriesId ?? '');
  const [coverImageId, setCoverImageId] = useState(initial?.coverImageId ?? '');
  const [illustrationImageIds, setIllustrationImageIds] = useState<string[]>(initial?.illustrationImageIds ?? []);
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? '');
  const [busy, setBusy] = useState(false);

  const initialId = initial?.id ?? null;
  useEffect(() => {
    if (!initialId) {
      setContent('');
      return;
    }
    let cancelled = false;
    setContent(null);
    void services.library.readContent(initialId).then(
      (text) => {
        if (!cancelled) setContent(text);
      },
      () => {
        if (!cancelled) setContent('');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [initialId, services]);

  const authors = snapshot.authors;

  /** 当前文章在所属系列里的编号（新选系列时为 null） */
  const position = initial ? articleSeriesPosition(snapshot, initial.id) : null;
  const selectedSeries = seriesId ? snapshot.series.find((series) => series.id === seriesId) : undefined;

  /** 表单内新建标签：按名称/别名判重，复用则返回现有 id；创建后刷新快照让列表立即可见。 */
  const createTag = async (category: TagCategory, name: string): Promise<{ id: string; created: boolean }> => {
    const key = normalizeName(name);
    const existed = snapshot.tags.some(
      (tag) =>
        tag.category === category &&
        (normalizeName(tag.name) === key || (tag.aliases ?? []).some((alias) => normalizeName(alias) === key)),
    );
    const id = await services.editor.saveTag({ category, name });
    await refresh();
    return { id, created: !existed };
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface/60 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSubmit({
          ...(initial ? { id: initial.id } : {}),
          type: seriesId ? 'series-entry' : 'short',
          title,
          summary,
          ...(initial ? (content === null ? {} : { content }) : { content: content ?? '' }),
          authorIds,
          translatorIds,
          characterTagIds,
          plotTagIds,
          ...(seriesId ? { seriesId } : {}),
          ...(coverImageId ? { coverImageId } : {}),
          illustrationImageIds,
          ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
        }).finally(() => setBusy(false));
      }}
    >
      <Field label="标题">
        <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required />
      </Field>

      <Field label="简介">
        <textarea className={inputClass} rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} />
      </Field>

      <Field label="正文（Markdown）" hint="保存后写到 articles/{id}.md；编辑元数据时不会覆盖正文。">
        <textarea
          className={`${inputClass} font-mono`}
          rows={12}
          value={content ?? ''}
          onChange={(event) => setContent(event.target.value)}
          placeholder={content === null ? '正在读取正文…' : '# 标题\n\n正文…'}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>系列</span>
          <SeriesPicker series={snapshot.series} value={seriesId} onChange={setSeriesId} />
          <span className="text-xs text-muted-foreground">
            {selectedSeries
              ? position && position.series.id === selectedSeries.id
                ? `当前为《${selectedSeries.title}》第 ${position.index} 篇（保存不会改变位置）`
                : `保存后会加在《${selectedSeries.title}》目录末尾`
              : '不属于系列的文章会保存为短篇'}
          </span>
        </div>
        <Field label="原出处">
          <input
            className={inputClass}
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      <AuthorPicker title="作者" authors={authors} value={authorIds} onChange={setAuthorIds} />
      <AuthorPicker title="译者" authors={authors} value={translatorIds} onChange={setTranslatorIds} />
      <TagPicker
        title="角色标签"
        category="character"
        options={snapshot.tags.filter((tag) => tag.category === 'character')}
        value={characterTagIds}
        onChange={setCharacterTagIds}
        onCreate={(name) => createTag('character', name)}
      />
      <TagPicker
        title="情节标签"
        category="plot"
        options={snapshot.tags.filter((tag) => tag.category === 'plot')}
        value={plotTagIds}
        onChange={setPlotTagIds}
        onCreate={(name) => createTag('plot', name)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="封面">
          <select className={inputClass} value={coverImageId} onChange={(event) => setCoverImageId(event.target.value)}>
            <option value="">无封面</option>
            {snapshot.images.map((image) => (
              <option key={image.id} value={image.id}>
                {image.id}
                {image.caption ? ` · ${image.caption}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <PickerRow
          title="插图（可多选）"
          options={snapshot.images.map((image) => ({ id: image.id, label: image.caption ?? image.id }))}
          value={illustrationImageIds}
          onChange={setIllustrationImageIds}
        />
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className={primaryClass} disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
        <button type="button" className={buttonClass} onClick={onCancel}>
          取消
        </button>
        {onExport ? (
          <button type="button" className={buttonClass} onClick={onExport}>
            导出这篇
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            className={`${buttonClass} ml-auto border-destructive/40 text-destructive`}
            onClick={() => void onDelete()}
          >
            删除
          </button>
        ) : null}
      </div>
    </form>
  );
}

function SeriesPanel({ snapshot, run, editor }: { snapshot: DBSnapshot; run: Run; editor: Editor }) {
  const [editing, setEditing] = useState<Series | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className={primaryClass}
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          新建系列
        </button>
        <PanelList
          items={snapshot.series}
          selectedId={editing?.id ?? null}
          onSelect={(series) => {
            setCreating(false);
            setEditing(series);
          }}
          render={(series) => (
            <>
              <span className="truncate">{series.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{series.articleIds.length} 篇</span>
            </>
          )}
        />
      </div>

      {creating || editing ? (
        <SeriesForm
          key={editing?.id ?? 'new'}
          snapshot={snapshot}
          initial={editing}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSubmit={async (draft) => {
            await run(async () => {
              await editor.saveSeries(draft);
            }, '系列已保存');
            setEditing(null);
            setCreating(false);
          }}
          onDelete={
            editing
              ? async () => {
                  if (!window.confirm(`删除《${editing.title}》？系列内文章会变成短篇。`)) return;
                  await run(async () => {
                    await editor.deleteSeries(editing.id);
                  }, '系列已删除');
                  setEditing(null);
                }
              : undefined
          }
        />
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          从左侧选择一个系列，或新建一个。
        </p>
      )}
    </div>
  );
}

function SeriesForm({
  snapshot,
  initial,
  onSubmit,
  onCancel,
  onDelete,
}: {
  snapshot: DBSnapshot;
  initial: Series | null;
  onSubmit(draft: Parameters<Editor['saveSeries']>[0]): Promise<void>;
  onCancel(): void;
  onDelete?: (() => Promise<void>) | undefined;
}) {
  const services = useServices();
  const { refresh } = useLibraryContext();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [status, setStatus] = useState<'ongoing' | 'completed'>(initial?.status ?? 'ongoing');
  const [articleIds, setArticleIds] = useState<string[]>(initial?.articleIds ?? []);
  const [authorIds, setAuthorIds] = useState<string[]>(initial?.authorIds ?? []);
  const [characterTagIds, setCharacterTagIds] = useState<string[]>(initial?.characterTagIds ?? []);
  const [plotTagIds, setPlotTagIds] = useState<string[]>(initial?.plotTagIds ?? []);
  const [coverImageId, setCoverImageId] = useState(initial?.coverImageId ?? '');
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? '');
  const [busy, setBusy] = useState(false);

  const createTag = async (category: TagCategory, name: string): Promise<{ id: string; created: boolean }> => {
    const key = normalizeName(name);
    const existed = snapshot.tags.some(
      (tag) =>
        tag.category === category &&
        (normalizeName(tag.name) === key || (tag.aliases ?? []).some((alias) => normalizeName(alias) === key)),
    );
    const id = await services.editor.saveTag({ category, name });
    await refresh();
    return { id, created: !existed };
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface/60 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSubmit({
          ...(initial ? { id: initial.id } : {}),
          title,
          summary,
          status,
          articleIds,
          authorIds,
          characterTagIds,
          plotTagIds,
          ...(coverImageId ? { coverImageId } : {}),
          ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
        }).finally(() => setBusy(false));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="标题">
          <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required />
        </Field>
        <Field label="状态">
          <select
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(event.target.value === 'completed' ? 'completed' : 'ongoing')}
          >
            <option value="ongoing">连载中</option>
            <option value="completed">已完结</option>
          </select>
        </Field>
      </div>

      <Field label="简介">
        <textarea className={inputClass} rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} />
      </Field>

      <ArticleOrderPicker articles={snapshot.articles} value={articleIds} onChange={setArticleIds} />

      <PickerRow
        title="作者"
        options={snapshot.authors.map((author) => ({ id: author.id, label: author.canonicalName }))}
        value={authorIds}
        onChange={setAuthorIds}
      />
      <TagPicker
        title="角色标签"
        category="character"
        options={snapshot.tags.filter((tag) => tag.category === 'character')}
        value={characterTagIds}
        onChange={setCharacterTagIds}
        onCreate={(name) => createTag('character', name)}
      />
      <TagPicker
        title="情节标签"
        category="plot"
        options={snapshot.tags.filter((tag) => tag.category === 'plot')}
        value={plotTagIds}
        onChange={setPlotTagIds}
        onCreate={(name) => createTag('plot', name)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="封面">
          <select className={inputClass} value={coverImageId} onChange={(event) => setCoverImageId(event.target.value)}>
            <option value="">无封面</option>
            {snapshot.images.map((image) => (
              <option key={image.id} value={image.id}>
                {image.caption ?? image.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="原出处">
          <input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className={primaryClass} disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
        <button type="button" className={buttonClass} onClick={onCancel}>
          取消
        </button>
        {onDelete ? (
          <button
            type="button"
            className={`${buttonClass} ml-auto border-destructive/40 text-destructive`}
            onClick={() => void onDelete()}
          >
            删除
          </button>
        ) : null}
      </div>
    </form>
  );
}

function AuthorsPanel({ snapshot, run, editor }: { snapshot: DBSnapshot; run: Run; editor: Editor }) {
  const [editing, setEditing] = useState<{ id?: string; canonicalName: string; aliases: string; notes: string; sourceUrl: string } | null>(
    null,
  );

  const startNew = () => setEditing({ canonicalName: '', aliases: '', notes: '', sourceUrl: '' });
  const startEdit = (id: string) => {
    const author = snapshot.authors.find((item) => item.id === id);
    if (!author) return;
    setEditing({
      id: author.id,
      canonicalName: author.canonicalName,
      aliases: author.aliases.join('，'),
      notes: author.notes ?? '',
      sourceUrl: author.sourceUrl ?? '',
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <button type="button" className={primaryClass} onClick={startNew}>
          新建作者
        </button>
        <PanelList
          items={snapshot.authors}
          selectedId={editing?.id ?? null}
          onSelect={(author) => startEdit(author.id)}
          render={(author) => (
            <>
              <span className="truncate">{author.canonicalName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{author.aliases.length} 别名</span>
            </>
          )}
        />
      </div>

      {editing ? (
        <form
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface/60 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await editor.saveAuthor({
                ...(editing.id ? { id: editing.id } : {}),
                canonicalName: editing.canonicalName,
                aliases: editing.aliases.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean),
                notes: editing.notes,
                sourceUrl: editing.sourceUrl,
              });
            }, '作者已保存');
            setEditing(null);
          }}
        >
          <Field label="常用名">
            <input
              className={inputClass}
              value={editing.canonicalName}
              onChange={(event) => setEditing({ ...editing, canonicalName: event.target.value })}
              required
            />
          </Field>
          <Field label="别名（逗号分隔）" hint="用已有别名保存时会复用原作者，不会新建。">
            <textarea
              className={inputClass}
              rows={2}
              value={editing.aliases}
              onChange={(event) => setEditing({ ...editing, aliases: event.target.value })}
            />
          </Field>
          <Field label="备注">
            <textarea
              className={inputClass}
              rows={2}
              value={editing.notes}
              onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
            />
          </Field>
          <Field label="主页 / 出处">
            <input
              className={inputClass}
              value={editing.sourceUrl}
              onChange={(event) => setEditing({ ...editing, sourceUrl: event.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2">
            <button type="submit" className={primaryClass}>
              保存
            </button>
            <button type="button" className={buttonClass} onClick={() => setEditing(null)}>
              取消
            </button>
            {editing.id ? (
              <button
                type="button"
                className={`${buttonClass} ml-auto border-destructive/40 text-destructive`}
                onClick={() => {
                  if (!window.confirm('删除作者会从所有文章/系列中移除引用，继续？')) return;
                  void run(async () => {
                    if (editing.id) await editor.deleteAuthor(editing.id);
                  }, '作者已删除');
                  setEditing(null);
                }}
              >
                删除
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          从左侧选择作者，或新建。
        </p>
      )}
    </div>
  );
}

function TagsPanel({ snapshot, run, editor }: { snapshot: DBSnapshot; run: Run; editor: Editor }) {
  const [editing, setEditing] = useState<{ id?: string; category: TagCategory; name: string; aliases: string } | null>(null);
  const [filter, setFilter] = useState<'all' | TagCategory>('all');
  const list = snapshot.tags.filter((tag) => filter === 'all' || tag.category === filter);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className={primaryClass}
          onClick={() => setEditing({ category: 'character', name: '', aliases: '' })}
        >
          新建标签
        </button>
        <select className={inputClass} value={filter} onChange={(event) => setFilter(event.target.value as 'all' | TagCategory)}>
          <option value="all">全部类别</option>
          <option value="character">角色</option>
          <option value="plot">情节</option>
          <option value="series">系列</option>
          <option value="general">通用</option>
        </select>
        <PanelList
          items={list}
          selectedId={editing?.id ?? null}
          onSelect={(tag: Tag) => setEditing({ id: tag.id, category: tag.category, name: tag.name, aliases: tag.aliases?.join('，') ?? '' })}
          render={(tag) => (
            <>
              <span className="truncate">{tag.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{tag.category}</span>
            </>
          )}
        />
      </div>

      {editing ? (
        <form
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface/60 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await editor.saveTag({
                ...(editing.id ? { id: editing.id } : {}),
                category: editing.category,
                name: editing.name,
                aliases: editing.aliases.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean),
              });
            }, '标签已保存');
            setEditing(null);
          }}
        >
          <Field label="类别">
            <select
              className={inputClass}
              value={editing.category}
              onChange={(event) => setEditing({ ...editing, category: event.target.value as TagCategory })}
            >
              <option value="character">角色</option>
              <option value="plot">情节</option>
              <option value="series">系列</option>
              <option value="general">通用</option>
            </select>
          </Field>
          <Field label="名称">
            <input
              className={inputClass}
              value={editing.name}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              required
            />
          </Field>
          <Field label="别名（逗号分隔）">
            <textarea
              className={inputClass}
              rows={2}
              value={editing.aliases}
              onChange={(event) => setEditing({ ...editing, aliases: event.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2">
            <button type="submit" className={primaryClass}>
              保存
            </button>
            <button type="button" className={buttonClass} onClick={() => setEditing(null)}>
              取消
            </button>
            {editing.id ? (
              <button
                type="button"
                className={`${buttonClass} ml-auto border-destructive/40 text-destructive`}
                onClick={() => {
                  if (!window.confirm('删除标签会从所有文章/系列中移除引用，继续？')) return;
                  void run(async () => {
                    if (editing.id) await editor.deleteTag(editing.id);
                  }, '标签已删除');
                  setEditing(null);
                }}
              >
                删除
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          从左侧选择标签，或新建。
        </p>
      )}
    </div>
  );
}

const IMAGE_KINDS: ImageKind[] = ['cover', 'illustration', 'captioned', 'other'];

function ImagesPanel({ snapshot, run, editor }: { snapshot: DBSnapshot; run: Run; editor: Editor }) {
  const services = useServices();
  const [kind, setKind] = useState<ImageKind>('cover');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { kind: ImageKind; caption: string }>>({});
  const loaded = services.library.current();
  const toUrl = (file: string) => (loaded ? services.platform.assets.toUrl(services.platform.paths.join(loaded.dir, file)) : '');

  return (
    <div className="flex flex-col gap-5">
      <form
        className="grid gap-3 rounded-xl border border-border bg-surface/60 p-4 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.querySelector<HTMLInputElement>('input[type=file]');
          const file = input?.files?.[0];
          if (!file) return;
          setBusy(true);
          void run(async () => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const ext = file.name.split('.').pop() ?? 'bin';
            await editor.saveImage({ bytes, ext, kind, caption });
            if (input) input.value = '';
          }, '图片已上传').finally(() => setBusy(false));
          setCaption('');
        }}
      >
        <Field label="图片文件">
          <input type="file" accept="image/*" className="text-sm" />
        </Field>
        <Field label="类型">
          <select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value as ImageKind)}>
            {IMAGE_KINDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="配文">
          <input className={inputClass} value={caption} onChange={(event) => setCaption(event.target.value)} />
        </Field>
        <button type="submit" className={primaryClass} disabled={busy}>
          上传
        </button>
      </form>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {snapshot.images.map((image) => {
          const draft = drafts[image.id] ?? { kind: image.kind, caption: image.caption ?? '' };
          return (
            <li key={image.id} className="flex gap-3 rounded-xl border border-border bg-surface/60 p-3">
              <img src={toUrl(image.file)} alt={image.caption ?? image.id} className="h-24 w-16 shrink-0 rounded object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="truncate text-xs text-muted-foreground">{image.file}</span>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  value={draft.kind}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [image.id]: { ...draft, kind: event.target.value as ImageKind } })
                  }
                >
                  {IMAGE_KINDS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  value={draft.caption}
                  placeholder="配文"
                  onChange={(event) => setDrafts({ ...drafts, [image.id]: { ...draft, caption: event.target.value } })}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-strong"
                    onClick={() =>
                      void run(async () => {
                        await editor.updateImage(image.id, { kind: draft.kind, caption: draft.caption });
                      }, '图片已更新')
                    }
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-surface-strong"
                    onClick={() => {
                      if (!window.confirm('删除图片会同时清掉引用它的封面/插图，继续？')) return;
                      void run(async () => {
                        await editor.deleteImage(image.id);
                      }, '图片已删除');
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FeaturedPanel({ snapshot, run, editor }: { snapshot: DBSnapshot; run: Run; editor: Editor }) {
  const [targetType, setTargetType] = useState<'article' | 'series'>('article');
  const [targetId, setTargetId] = useState('');
  const [rows, setRows] = useState<Recommendation[]>([{ author: '', text: '' }]);

  const options =
    targetType === 'article'
      ? snapshot.articles.map((article) => ({ id: article.id, label: article.title }))
      : snapshot.series.map((series) => ({ id: series.id, label: series.title }));

  const pick = (type: 'article' | 'series', id: string) => {
    setTargetType(type);
    setTargetId(id);
    const entry = snapshot.featured.find((item) => item.targetType === type && item.targetId === id);
    setRows(entry && entry.recommendations.length > 0 ? entry.recommendations : [{ author: '', text: '' }]);
  };

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface/60">
        {snapshot.featured.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">还没有推荐语。</li>
        ) : null}
        {snapshot.featured.map((entry) => {
          const title =
            entry.targetType === 'article'
              ? snapshot.articles.find((article) => article.id === entry.targetId)?.title
              : snapshot.series.find((series) => series.id === entry.targetId)?.title;
          return (
            <li key={`${entry.targetType}:${entry.targetId}`} className="flex items-start gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{title ?? `${entry.targetId}（目标缺失）`}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.targetType === 'article' ? '文章' : '系列'} · {entry.recommendations.length} 条推荐语
                </p>
              </div>
              <button type="button" className={buttonClass} onClick={() => pick(entry.targetType, entry.targetId)}>
                编辑
              </button>
              <button
                type="button"
                className={`${buttonClass} text-destructive`}
                onClick={() =>
                  void run(async () => {
                    await editor.deleteFeatured(entry.targetType, entry.targetId);
                  }, '推荐语已删除')
                }
              >
                删除
              </button>
            </li>
          );
        })}
      </ul>

      <form
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface/60 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const cleaned = rows
            .map((row) => ({ author: row.author?.trim() ?? '', text: row.text.trim() }))
            .filter((row) => row.text.length > 0)
            .map((row) => (row.author ? { author: row.author, text: row.text } : { text: row.text }));
          if (!targetId || cleaned.length === 0) return;
          void run(async () => {
            await editor.saveFeatured(targetType, targetId, cleaned);
          }, '推荐语已保存');
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="目标类型">
            <select
              className={inputClass}
              value={targetType}
              onChange={(event) => {
                const next = event.target.value === 'series' ? 'series' : 'article';
                setTargetType(next);
                setTargetId('');
                setRows([{ author: '', text: '' }]);
              }}
            >
              <option value="article">文章</option>
              <option value="series">系列</option>
            </select>
          </Field>
          <Field label="目标">
            <select className={inputClass} value={targetId} onChange={(event) => pick(targetType, event.target.value)}>
              <option value="">请选择</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className={labelClass}>推荐语（可多条，可只填文本）</span>
          {rows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input
                className={`${inputClass} sm:w-40`}
              value={row.author ?? ''}
                placeholder="推荐人"
                onChange={(event) => setRows(rows.map((item, i) => (i === index ? { ...item, author: event.target.value } : item)))}
              />
              <input
                className={inputClass}
                value={row.text}
                placeholder="推荐语"
                onChange={(event) => setRows(rows.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)))}
              />
              <button
                type="button"
                className={buttonClass}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                aria-label="删除这条推荐语"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className={buttonClass} onClick={() => setRows([...rows, { author: '', text: '' }])}>
            添加一条
          </button>
        </div>

        <button type="submit" className={primaryClass} disabled={!targetId}>
          保存推荐语
        </button>
      </form>
    </div>
  );
}

function CreditsPanel({ snapshot, run, editor }: { snapshot: DBSnapshot; run: Run; editor: Editor }) {
  const [rows, setRows] = useState<CreditsEntry[]>(() => snapshot.credits.map((entry) => ({ ...entry })));

  const move = (index: number, delta: number) => {
    const next = [...rows];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
    setRows(next);
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface/60 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const cleaned = rows
          .map((row) => ({
            name: row.name.trim(),
            ...(row.role?.trim() ? { role: row.role.trim() } : {}),
            ...(row.link?.trim() ? { link: row.link.trim() } : {}),
            ...(row.note?.trim() ? { note: row.note.trim() } : {}),
          }))
          .filter((row) => row.name.length > 0);
        void run(async () => {
          await editor.saveCredits(cleaned);
        }, '鸣谢已保存');
      }}
    >
      <p className="text-xs text-muted-foreground">顺序即展示顺序，用 ↑↓ 调整。</p>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[10rem_8rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            className={inputClass}
            value={row.name}
            placeholder="名字"
            onChange={(event) => setRows(rows.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))}
          />
          <input
            className={inputClass}
            value={row.role ?? ''}
            placeholder="角色"
            onChange={(event) => setRows(rows.map((item, i) => (i === index ? { ...item, role: event.target.value } : item)))}
          />
          <input
            className={inputClass}
            value={row.link ?? ''}
            placeholder="链接"
            onChange={(event) => setRows(rows.map((item, i) => (i === index ? { ...item, link: event.target.value } : item)))}
          />
          <input
            className={inputClass}
            value={row.note ?? ''}
            placeholder="备注"
            onChange={(event) => setRows(rows.map((item, i) => (i === index ? { ...item, note: event.target.value } : item)))}
          />
          <div className="flex gap-1">
            <button type="button" className={buttonClass} onClick={() => move(index, -1)} aria-label="上移">
              ↑
            </button>
            <button type="button" className={buttonClass} onClick={() => move(index, 1)} aria-label="下移">
              ↓
            </button>
            <button
              type="button"
              className={`${buttonClass} text-destructive`}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
              aria-label="删除"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => setRows([...rows, { name: '' }])}>
          添加一行
        </button>
        <button type="submit" className={primaryClass}>
          保存鸣谢
        </button>
      </div>
    </form>
  );
}
