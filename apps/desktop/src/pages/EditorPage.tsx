import type { DBSnapshot, Editor } from '@tpr/core';
import { articleSeriesPosition } from '@tpr/core';
import type {
  ArticleMeta,
  CreditsEntry,
  ImageAsset,
  ImageKind,
  Recommendation,
  Series,
  Tag,
  TagCategory,
} from '@tpr/schema';
import { normalizeName } from '@tpr/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArticleOrderPicker } from '../components/ArticleOrderPicker.js';
import { AuthorPicker } from '../components/AuthorPicker.js';
import { DraftList } from '../components/DraftList.js';
import { ImageFilePicker } from '../components/ImageFilePicker.js';
import { SeriesPicker } from '../components/SeriesPicker.js';
import { TagPicker } from '../components/TagPicker.js';
import { useServices } from '../context.js';
import type { DraftStore } from '../editor/drafts.js';
import { IMAGE_ACCEPT, validateImageFile } from '../editor/images.js';
import {
  EDITOR_KIND_LABEL,
  EDITOR_KINDS,
  type EditorKind,
  type EditorSearchHit,
  searchEditor,
  TAG_CATEGORY_LABEL,
} from '../editor/search.js';
import { useDraftAutosave, useDraftBox, useDraftStore } from '../editor/useDraft.js';
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
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

const IMAGE_KIND_LABEL: Record<ImageAsset['kind'], string> = {
  cover: '封面',
  illustration: '插图',
  captioned: '配图',
  other: '其他',
};

function coverOptionLabel(image: ImageAsset): string {
  const kind = IMAGE_KIND_LABEL[image.kind];
  return image.caption ? `${image.caption}（${kind}）` : `${kind} · ${image.id}`;
}

/**
 * 封面字段：下拉选库里已有图片，或直接上传一张（Goal 17）。
 * 上传会立即写成 `kind='cover'` 的 ImageAsset，并自动选中，省掉“先去图片标签页再回来”的两步。
 * 按钮做成主按钮并显示缩略图，让「选封面」在文章表单里也一眼可见。
 */
function CoverField({
  images,
  value,
  onChange,
}: {
  images: ImageAsset[];
  value: string;
  onChange: (id: string) => void;
}) {
  const services = useServices();
  const { refresh } = useLibraryContext();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = images.find((image) => image.id === value);
  const loaded = services.library.current();
  const previewUrl =
    selected && loaded
      ? services.platform.assets.toUrl(services.platform.paths.join(loaded.dir, selected.file))
      : '';

  const upload = async (file: File): Promise<void> => {
    const invalid = validateImageFile(file);
    if (invalid !== null) {
      setMessage(invalid);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = file.name.split('.').pop() ?? 'bin';
      const caption = file.name.replace(/\.[^.]+$/, '');
      const id = await services.editor.saveImage({ bytes, ext, kind: 'cover', caption });
      await refresh();
      onChange(id);
      setMessage(`已上传并选中：${file.name}`);
    } catch (error) {
      setMessage(`上传失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelClass}>封面</span>
      <div className="flex items-center gap-2">
        {previewUrl !== '' ? (
          <img
            src={previewUrl}
            alt={selected?.caption ?? '当前封面'}
            className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
          />
        ) : null}
        <select
          className={`${inputClass} min-w-0 flex-1`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">无封面</option>
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {coverOptionLabel(image)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden>🖼️</span>
          {busy ? '上传中…' : value === '' ? '选择封面图片' : '更换封面图片'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {message ??
          '上传的图片会存进数据库的 images/ 目录，并自动选中；也可在「图片」标签页统一管理。'}
      </span>
    </div>
  );
}

export function EditorPage() {
  const services = useServices();
  const { snapshot, refresh } = useLibraryContext();
  const [tab, setTab] = useState<Tab>('articles');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeHit, setActiveHit] = useState(0);
  const [focus, setFocus] = useState<{ kind: EditorKind; id: string; token: number } | null>(null);
  const search = useMemo(
    () => (snapshot ? searchEditor(snapshot, query) : null),
    [snapshot, query],
  );

  if (!snapshot) {
    return (
      <p className="text-sm text-muted-foreground">还没有导入数据库，先在首页拖入一个 .tpr。</p>
    );
  }

  const hits = search?.hits ?? [];
  const matched = search ? EDITOR_KINDS.reduce((sum, kind) => sum + search.totals[kind], 0) : 0;

  const pickHit = (hit: EditorSearchHit): void => {
    setTab(hit.kind as Tab);
    setQuery('');
    setSearchOpen(false);
    setActiveHit(0);
    setFocus({ kind: hit.kind, id: hit.id, token: Date.now() });
    setError(null);
    setNotice(null);
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!searchOpen) {
        // 第一次按 ↓ 只是把候选列表打开并停在第一项，不应跳过首项
        setSearchOpen(true);
        setActiveHit(0);
        return;
      }
      setActiveHit((current) => (hits.length === 0 ? 0 : Math.min(current + 1, hits.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveHit((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      // 列表已按 Esc 收起时，Enter 只负责重新打开，避免"看不见结果却跳走"
      if (!searchOpen) {
        setSearchOpen(true);
        return;
      }
      const hit = hits[activeHit];
      if (hit) {
        event.preventDefault();
        pickHit(hit);
      }
      return;
    }
    if (event.key === 'Escape') setSearchOpen(false);
  };

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

      <div className="relative z-20">
        <input
          type="text"
          role="combobox"
          aria-label="搜索编辑器内容"
          aria-expanded={searchOpen && Boolean(search)}
          aria-controls="editor-search-results"
          aria-activedescendant={
            searchOpen && hits[activeHit]
              ? `editor-hit-${hits[activeHit].kind}-${hits[activeHit].id}`
              : undefined
          }
          placeholder="搜索文章、系列、作者、标签、图片、推荐语、鸣谢…（不含正文）"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearchOpen(true);
            setActiveHit(0);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
          onKeyDown={onSearchKeyDown}
          className={inputClass}
        />
        {search && searchOpen ? (
          <div className="absolute inset-x-0 top-full mt-2 max-h-[26rem] overflow-auto rounded-xl border border-border bg-background p-2 shadow-xl">
            <div
              id="editor-search-results"
              role="listbox"
              aria-label="编辑器搜索结果"
              className="flex flex-col gap-2"
            >
              {hits.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配项。</p>
              ) : null}
              {EDITOR_KINDS.map((kind) => {
                const group = hits.filter((hit) => hit.kind === kind);
                if (group.length === 0) return null;
                return (
                  <div key={kind}>
                    <p className="px-2 pb-1 text-[0.68rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                      {EDITOR_KIND_LABEL[kind]} · {search.totals[kind]}
                    </p>
                    <div className="flex flex-col">
                      {group.map((hit) => {
                        const index = hits.indexOf(hit);
                        return (
                          <div key={`${hit.kind}:${hit.id}`}>
                            <button
                              type="button"
                              role="option"
                              id={`editor-hit-${hit.kind}-${hit.id}`}
                              aria-selected={index === activeHit}
                              aria-label={`打开${EDITOR_KIND_LABEL[hit.kind]}《${hit.label}》`}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => pickHit(hit)}
                              onMouseEnter={() => setActiveHit(index)}
                              className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-sm ${
                                index === activeHit
                                  ? 'bg-accent-soft text-accent'
                                  : 'hover:bg-surface-strong'
                              }`}
                            >
                              <span className="truncate">{hit.label}</span>
                              {hit.detail ? (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {hit.detail}
                                </span>
                              ) : null}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-border px-2 pt-2 text-xs text-muted-foreground">
              共 {matched} 项匹配 · ↑↓ 选择，Enter 打开 · 只搜实体字段，不含正文
            </p>
          </div>
        ) : null}
      </div>

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

      {tab === 'articles' ? (
        <ArticlesPanel
          snapshot={snapshot}
          run={run}
          editor={services.editor}
          visibleIds={search ? search.ids.articles : null}
          focus={focus?.kind === 'articles' ? focus : null}
        />
      ) : null}
      {tab === 'series' ? (
        <SeriesPanel
          snapshot={snapshot}
          run={run}
          editor={services.editor}
          visibleIds={search ? search.ids.series : null}
          focus={focus?.kind === 'series' ? focus : null}
        />
      ) : null}
      {tab === 'authors' ? (
        <AuthorsPanel
          snapshot={snapshot}
          run={run}
          editor={services.editor}
          visibleIds={search ? search.ids.authors : null}
          focus={focus?.kind === 'authors' ? focus : null}
        />
      ) : null}
      {tab === 'tags' ? (
        <TagsPanel
          snapshot={snapshot}
          run={run}
          editor={services.editor}
          visibleIds={search ? search.ids.tags : null}
          focus={focus?.kind === 'tags' ? focus : null}
        />
      ) : null}
      {tab === 'images' ? (
        <ImagesPanel
          snapshot={snapshot}
          run={run}
          editor={services.editor}
          visibleIds={search ? search.ids.images : null}
          focus={focus?.kind === 'images' ? focus : null}
        />
      ) : null}
      {tab === 'featured' ? (
        <FeaturedPanel
          snapshot={snapshot}
          run={run}
          editor={services.editor}
          visibleIds={search ? search.ids.featured : null}
          focus={focus?.kind === 'featured' ? focus : null}
        />
      ) : null}
      {tab === 'credits' ? (
        <CreditsPanel
          snapshot={snapshot}
          run={run}
          editor={services.editor}
          visibleIds={search ? search.ids.credits : null}
          focus={focus?.kind === 'credits' ? focus : null}
        />
      ) : null}
    </section>
  );
}

type Run = (action: () => Promise<void>, done: string) => Promise<void>;

/**
 * 搜索跳转：只在 focus.token 变化时执行一次。
 *
 * 不能把 snapshot / box / setEditing 放进依赖列表——保存后 `refresh()` 会换一份 snapshot，
 * 那些依赖会立刻把正在编辑（甚至带草稿）的表单重置掉。用 ref 保存最新回调，依赖只留 id/token。
 */
function useFocusJump(
  focus: { id: string; token: number } | null,
  onJump: (id: string) => void,
): void {
  const callback = useRef(onJump);
  const token = focus?.token;
  const id = focus?.id;

  useEffect(() => {
    callback.current = onJump;
  }, [onJump]);

  useEffect(() => {
    if (token === undefined || id === undefined) return;
    callback.current(id);
  }, [token, id]);
}

function PanelList<T>({
  items,
  selectedId,
  onSelect,
  render,
  empty,
}: {
  items: T[];
  selectedId: string | null;
  onSelect(item: T): void;
  render(item: T): React.ReactNode;
  empty?: string;
}) {
  return (
    <ul className="flex max-h-[28rem] flex-col divide-y divide-border overflow-auto rounded-xl border border-border bg-surface/60">
      {items.length === 0 && empty ? (
        <li className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</li>
      ) : null}
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
        {options.length === 0 ? (
          <span className="text-xs text-muted-foreground">还没有可选条目</span>
        ) : null}
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(option.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, option.id]
                    : value.filter((id) => id !== option.id),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function ArticlesPanel({
  snapshot,
  run,
  editor,
  visibleIds = null,
  focus = null,
}: {
  snapshot: DBSnapshot;
  run: Run;
  editor: Editor;
  visibleIds?: Set<string> | null;
  focus?: { id: string; token: number } | null;
}) {
  const library = useLibraryContext();
  const services = useServices();
  const databaseId = services.library.current()?.databaseId ?? '';
  const store = useDraftStore(databaseId);
  const box = useDraftBox<ArticleDraftPayload>(store, 'article');
  const [editing, setEditing] = useState<ArticleMeta | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftPayload, setDraftPayload] = useState<ArticleDraftPayload | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const openDraft = (id: string) => {
    const draft = box.open(id);
    if (!draft) return;
    setEditing(null);
    setCreating(true);
    setDraftPayload((draft.payload as ArticleDraftPayload | undefined) ?? null);
  };

  const startNew = () => {
    box.start();
    setEditing(null);
    setCreating(true);
    setDraftPayload(null);
  };

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
    setDraftPayload(null);
    box.close();
  };

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visible = visibleIds
    ? snapshot.articles.filter((article) => visibleIds.has(article.id))
    : snapshot.articles;

  useFocusJump(focus, (id) => {
    const target = snapshot.articles.find((article) => article.id === id);
    if (!target) return;
    box.close();
    setCreating(false);
    setDraftPayload(null);
    setEditing(target);
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <button type="button" className={primaryClass} onClick={startNew}>
          新建文章
        </button>
        <DraftList
          drafts={box.drafts}
          selectedId={box.draftId}
          onOpen={(draft) => openDraft(draft.id)}
          onDelete={(id) => {
            const wasOpen = box.draftId === id;
            box.discard(id);
            if (wasOpen) {
              setCreating(false);
              setDraftPayload(null);
            }
          }}
        />
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-muted-foreground">
            多选导出（已选 {picked.size}）
          </summary>
          <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-auto">
            {snapshot.articles.map((article) => (
              <label key={article.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(article.id)}
                  onChange={() => togglePicked(article.id)}
                />
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
          items={visible}
          selectedId={editing?.id ?? null}
          empty="没有匹配的文章。"
          onSelect={(article) => {
            setCreating(false);
            setDraftPayload(null);
            box.close();
            setEditing(article);
          }}
          render={(article) => {
            const position = articleSeriesPosition(snapshot, article.id);
            return (
              <>
                <span className="truncate">{article.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {article.type === 'short'
                    ? '短篇'
                    : position
                      ? `第 ${position.index} 篇`
                      : '系列'}
                </span>
              </>
            );
          }}
        />
      </div>

      {creating || editing ? (
        <ArticleForm
          key={box.draftId ?? editing?.id ?? 'new'}
          snapshot={snapshot}
          initial={editing}
          draft={draftPayload}
          draftId={box.draftId}
          draftStore={store}
          onCancel={closeForm}
          onSubmit={async (draft) => {
            await run(async () => {
              await editor.saveArticle(draft);
            }, '文章已保存');
            if (box.draftId) box.discard(box.draftId);
            closeForm();
          }}
          onExport={
            editing ? () => void library.exportSelection({ articles: [editing.id] }) : undefined
          }
          onDelete={
            editing
              ? async () => {
                  if (!window.confirm(`删除《${editing.title}》？该操作会同时更新系列目录与精选。`))
                    return;
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

export interface ArticleDraftPayload {
  title: string;
  summary: string;
  content: string;
  authorIds: string[];
  translatorIds: string[];
  characterTagIds: string[];
  plotTagIds: string[];
  seriesId: string;
  coverImageId: string;
  illustrationImageIds: string[];
  sourceUrl: string;
}

function ArticleForm({
  snapshot,
  initial,
  draft,
  draftId,
  draftStore,
  onSubmit,
  onCancel,
  onDelete,
  onExport,
}: {
  snapshot: DBSnapshot;
  initial: ArticleMeta | null;
  draft?: ArticleDraftPayload | null;
  draftId?: string | null;
  draftStore?: DraftStore | null;
  onSubmit(draft: Parameters<Editor['saveArticle']>[0]): Promise<void>;
  onCancel(): void;
  onDelete?: (() => Promise<void>) | undefined;
  onExport?: (() => void) | undefined;
}) {
  const services = useServices();
  const { refresh } = useLibraryContext();
  const [title, setTitle] = useState(draft?.title ?? initial?.title ?? '');
  const [summary, setSummary] = useState(draft?.summary ?? initial?.summary ?? '');
  const [content, setContent] = useState<string | null>(
    draft ? draft.content : initial ? null : '',
  );
  const [authorIds, setAuthorIds] = useState<string[]>(
    draft?.authorIds ?? initial?.authorIds ?? [],
  );
  const [translatorIds, setTranslatorIds] = useState<string[]>(
    draft?.translatorIds ?? initial?.translatorIds ?? [],
  );
  const [characterTagIds, setCharacterTagIds] = useState<string[]>(
    draft?.characterTagIds ?? initial?.characterTagIds ?? [],
  );
  const [plotTagIds, setPlotTagIds] = useState<string[]>(
    draft?.plotTagIds ?? initial?.plotTagIds ?? [],
  );
  const [seriesId, setSeriesId] = useState(draft?.seriesId ?? initial?.seriesId ?? '');
  const [coverImageId, setCoverImageId] = useState(
    draft?.coverImageId ?? initial?.coverImageId ?? '',
  );
  const [illustrationImageIds, setIllustrationImageIds] = useState<string[]>(
    draft?.illustrationImageIds ?? initial?.illustrationImageIds ?? [],
  );
  const [sourceUrl, setSourceUrl] = useState(draft?.sourceUrl ?? initial?.sourceUrl ?? '');
  const [busy, setBusy] = useState(false);

  const draftPayload = useMemo<ArticleDraftPayload | null>(
    () =>
      content === null
        ? null
        : {
            title,
            summary,
            content,
            authorIds,
            translatorIds,
            characterTagIds,
            plotTagIds,
            seriesId,
            coverImageId,
            illustrationImageIds,
            sourceUrl,
          },
    [
      content,
      title,
      summary,
      authorIds,
      translatorIds,
      characterTagIds,
      plotTagIds,
      seriesId,
      coverImageId,
      illustrationImageIds,
      sourceUrl,
    ],
  );
  const { error: draftError } = useDraftAutosave({
    store: draftStore ?? null,
    draftId: draftId ?? null,
    kind: 'article',
    label: title.trim() || '未命名文章',
    payload: draftPayload,
    enabled: !initial && Boolean(draftId && draftStore),
  });

  const initialId = initial?.id ?? null;
  const hasDraft = Boolean(draft);
  useEffect(() => {
    // 草稿里的正文以草稿为准，不能被「新建 = 空正文」的初始化覆盖
    if (hasDraft) return;
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
  }, [hasDraft, initialId, services]);

  const authors = snapshot.authors;

  /** 当前文章在所属系列里的编号（新选系列时为 null） */
  const position = initial ? articleSeriesPosition(snapshot, initial.id) : null;
  const selectedSeries = seriesId
    ? snapshot.series.find((series) => series.id === seriesId)
    : undefined;

  /** 表单内新建标签：按名称/别名判重，复用则返回现有 id；创建后刷新快照让列表立即可见。 */
  const createTag = async (
    category: TagCategory,
    name: string,
  ): Promise<{ id: string; created: boolean }> => {
    const key = normalizeName(name);
    const existed = snapshot.tags.some(
      (tag) =>
        tag.category === category &&
        (normalizeName(tag.name) === key ||
          (tag.aliases ?? []).some((alias) => normalizeName(alias) === key)),
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
      {draftError ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          草稿未保存：{draftError}
        </p>
      ) : null}
      <Field label="标题">
        <input
          className={inputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </Field>

      <Field label="简介">
        <textarea
          className={inputClass}
          rows={2}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </Field>

      <Field
        label="正文（Markdown）"
        hint="保存后写到 articles/{id}.md；编辑元数据时不会覆盖正文。"
      >
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
      <AuthorPicker
        title="译者"
        authors={authors}
        value={translatorIds}
        onChange={setTranslatorIds}
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
        <CoverField images={snapshot.images} value={coverImageId} onChange={setCoverImageId} />
        <PickerRow
          title="插图（可多选）"
          options={snapshot.images.map((image) => ({
            id: image.id,
            label: image.caption ?? image.id,
          }))}
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

export interface SeriesDraftPayload {
  title: string;
  summary: string;
  status: 'ongoing' | 'completed';
  articleIds: string[];
  authorIds: string[];
  translatorIds: string[];
  characterTagIds: string[];
  plotTagIds: string[];
  coverImageId: string;
  sourceUrl: string;
}

function SeriesPanel({
  snapshot,
  run,
  editor,
  visibleIds = null,
  focus = null,
}: {
  snapshot: DBSnapshot;
  run: Run;
  editor: Editor;
  visibleIds?: Set<string> | null;
  focus?: { id: string; token: number } | null;
}) {
  const services = useServices();
  const databaseId = services.library.current()?.databaseId ?? '';
  const store = useDraftStore(databaseId);
  const box = useDraftBox<SeriesDraftPayload>(store, 'series');
  const [editing, setEditing] = useState<Series | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftPayload, setDraftPayload] = useState<SeriesDraftPayload | null>(null);

  const openDraft = (id: string) => {
    const draft = box.open(id);
    if (!draft) return;
    setEditing(null);
    setCreating(true);
    setDraftPayload((draft.payload as SeriesDraftPayload | undefined) ?? null);
  };

  const visible = visibleIds
    ? snapshot.series.filter((series) => visibleIds.has(series.id))
    : snapshot.series;

  useFocusJump(focus, (id) => {
    const target = snapshot.series.find((series) => series.id === id);
    if (!target) return;
    box.close();
    setCreating(false);
    setDraftPayload(null);
    setEditing(target);
  });

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
    setDraftPayload(null);
    box.close();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className={primaryClass}
          onClick={() => {
            box.start();
            setEditing(null);
            setCreating(true);
            setDraftPayload(null);
          }}
        >
          新建系列
        </button>
        <DraftList
          drafts={box.drafts}
          selectedId={box.draftId}
          onOpen={(draft) => openDraft(draft.id)}
          onDelete={(id) => {
            const wasOpen = box.draftId === id;
            box.discard(id);
            if (wasOpen) {
              setCreating(false);
              setDraftPayload(null);
            }
          }}
        />
        <PanelList
          items={visible}
          empty="没有匹配的系列。"
          selectedId={editing?.id ?? null}
          onSelect={(series) => {
            setCreating(false);
            setDraftPayload(null);
            box.close();
            setEditing(series);
          }}
          render={(series) => (
            <>
              <span className="truncate">{series.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {series.articleIds.length} 篇
              </span>
            </>
          )}
        />
      </div>

      {creating || editing ? (
        <SeriesForm
          key={box.draftId ?? editing?.id ?? 'new'}
          snapshot={snapshot}
          initial={editing}
          draft={draftPayload}
          draftId={box.draftId}
          draftStore={store}
          onCancel={closeForm}
          onSubmit={async (draft) => {
            await run(async () => {
              await editor.saveSeries(draft);
            }, '系列已保存');
            if (box.draftId) box.discard(box.draftId);
            closeForm();
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
  draft,
  draftId,
  draftStore,
  onSubmit,
  onCancel,
  onDelete,
}: {
  snapshot: DBSnapshot;
  initial: Series | null;
  draft?: SeriesDraftPayload | null;
  draftId?: string | null;
  draftStore?: DraftStore | null;
  onSubmit(draft: Parameters<Editor['saveSeries']>[0]): Promise<void>;
  onCancel(): void;
  onDelete?: (() => Promise<void>) | undefined;
}) {
  const services = useServices();
  const { refresh } = useLibraryContext();
  const [title, setTitle] = useState(draft?.title ?? initial?.title ?? '');
  const [summary, setSummary] = useState(draft?.summary ?? initial?.summary ?? '');
  const [status, setStatus] = useState<'ongoing' | 'completed'>(
    draft?.status ?? initial?.status ?? 'ongoing',
  );
  const [articleIds, setArticleIds] = useState<string[]>(
    draft?.articleIds ?? initial?.articleIds ?? [],
  );
  const [authorIds, setAuthorIds] = useState<string[]>(
    draft?.authorIds ?? initial?.authorIds ?? [],
  );
  const [translatorIds, setTranslatorIds] = useState<string[]>(
    draft?.translatorIds ?? initial?.translatorIds ?? [],
  );
  const [characterTagIds, setCharacterTagIds] = useState<string[]>(
    draft?.characterTagIds ?? initial?.characterTagIds ?? [],
  );
  const [plotTagIds, setPlotTagIds] = useState<string[]>(
    draft?.plotTagIds ?? initial?.plotTagIds ?? [],
  );
  const [coverImageId, setCoverImageId] = useState(
    draft?.coverImageId ?? initial?.coverImageId ?? '',
  );
  const [sourceUrl, setSourceUrl] = useState(draft?.sourceUrl ?? initial?.sourceUrl ?? '');
  const [busy, setBusy] = useState(false);

  const draftPayload = useMemo<SeriesDraftPayload>(
    () => ({
      title,
      summary,
      status,
      articleIds,
      authorIds,
      translatorIds,
      characterTagIds,
      plotTagIds,
      coverImageId,
      sourceUrl,
    }),
    [
      title,
      summary,
      status,
      articleIds,
      authorIds,
      translatorIds,
      characterTagIds,
      plotTagIds,
      coverImageId,
      sourceUrl,
    ],
  );
  const { error: draftError } = useDraftAutosave({
    store: draftStore ?? null,
    draftId: draftId ?? null,
    kind: 'series',
    label: title.trim() || '未命名系列',
    payload: draftPayload,
    enabled: !initial && Boolean(draftId && draftStore),
  });

  const createTag = async (
    category: TagCategory,
    name: string,
  ): Promise<{ id: string; created: boolean }> => {
    const key = normalizeName(name);
    const existed = snapshot.tags.some(
      (tag) =>
        tag.category === category &&
        (normalizeName(tag.name) === key ||
          (tag.aliases ?? []).some((alias) => normalizeName(alias) === key)),
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
          translatorIds,
          characterTagIds,
          plotTagIds,
          ...(coverImageId ? { coverImageId } : {}),
          ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
        }).finally(() => setBusy(false));
      }}
    >
      {draftError ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          草稿未保存：{draftError}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="标题">
          <input
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </Field>
        <Field label="状态">
          <select
            className={inputClass}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value === 'completed' ? 'completed' : 'ongoing')
            }
          >
            <option value="ongoing">连载中</option>
            <option value="completed">已完结</option>
          </select>
        </Field>
      </div>

      <Field label="简介">
        <textarea
          className={inputClass}
          rows={2}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </Field>

      <ArticleOrderPicker
        articles={snapshot.articles}
        value={articleIds}
        onChange={setArticleIds}
      />

      <AuthorPicker
        title="作者"
        authors={snapshot.authors}
        value={authorIds}
        onChange={setAuthorIds}
      />
      <AuthorPicker
        title="译者"
        authors={snapshot.authors}
        value={translatorIds}
        onChange={setTranslatorIds}
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
        <CoverField images={snapshot.images} value={coverImageId} onChange={setCoverImageId} />
        <Field label="原出处">
          <input
            className={inputClass}
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
          />
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

export interface AuthorDraftPayload {
  canonicalName: string;
  aliases: string;
  notes: string;
  sourceUrl: string;
}

function AuthorsPanel({
  snapshot,
  run,
  editor,
  visibleIds = null,
  focus = null,
}: {
  snapshot: DBSnapshot;
  run: Run;
  editor: Editor;
  visibleIds?: Set<string> | null;
  focus?: { id: string; token: number } | null;
}) {
  const services = useServices();
  const databaseId = services.library.current()?.databaseId ?? '';
  const store = useDraftStore(databaseId);
  const box = useDraftBox<AuthorDraftPayload>(store, 'author');
  const [editing, setEditing] = useState<{
    id?: string;
    canonicalName: string;
    aliases: string;
    notes: string;
    sourceUrl: string;
  } | null>(null);

  const startNew = () => {
    box.start();
    setEditing({ canonicalName: '', aliases: '', notes: '', sourceUrl: '' });
  };
  const openDraft = (id: string) => {
    const draft = box.open(id);
    if (!draft) return;
    const payload = (draft.payload as AuthorDraftPayload | undefined) ?? {
      canonicalName: '',
      aliases: '',
      notes: '',
      sourceUrl: '',
    };
    setEditing({ ...payload });
  };
  const visibleAuthors = visibleIds
    ? snapshot.authors.filter((author) => visibleIds.has(author.id))
    : snapshot.authors;

  const startEdit = (id: string) => {
    const author = snapshot.authors.find((item) => item.id === id);
    if (!author) return;
    box.close();
    setEditing({
      id: author.id,
      canonicalName: author.canonicalName,
      aliases: author.aliases.join('，'),
      notes: author.notes ?? '',
      sourceUrl: author.sourceUrl ?? '',
    });
  };

  const draftPayload = useMemo<AuthorDraftPayload | null>(
    () =>
      editing && !editing.id
        ? {
            canonicalName: editing.canonicalName,
            aliases: editing.aliases,
            notes: editing.notes,
            sourceUrl: editing.sourceUrl,
          }
        : null,
    [editing],
  );

  useFocusJump(focus, startEdit);

  const { error: draftError } = useDraftAutosave({
    store,
    draftId: box.draftId,
    kind: 'author',
    label: editing?.canonicalName.trim() || '未命名作者',
    payload: draftPayload,
    enabled: Boolean(draftPayload) && editing?.id === undefined,
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <button type="button" className={primaryClass} onClick={startNew}>
          新建作者
        </button>
        <DraftList
          drafts={box.drafts}
          selectedId={box.draftId}
          onOpen={(draft) => openDraft(draft.id)}
          onDelete={(id) => {
            const wasOpen = box.draftId === id;
            box.discard(id);
            if (wasOpen) setEditing(null);
          }}
        />
        <PanelList
          items={visibleAuthors}
          empty="没有匹配的作者。"
          selectedId={editing?.id ?? null}
          onSelect={(author) => startEdit(author.id)}
          render={(author) => (
            <>
              <span className="truncate">{author.canonicalName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {author.aliases.length} 别名
              </span>
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
                aliases: editing.aliases
                  .split(/[，,、\n]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
                notes: editing.notes,
                sourceUrl: editing.sourceUrl,
              });
            }, '作者已保存');
            if (box.draftId) box.discard(box.draftId);
            setEditing(null);
          }}
        >
          {draftError ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              草稿未保存：{draftError}
            </p>
          ) : null}
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

export interface TagDraftPayload {
  category: TagCategory;
  name: string;
  aliases: string;
}

function TagsPanel({
  snapshot,
  run,
  editor,
  visibleIds = null,
  focus = null,
}: {
  snapshot: DBSnapshot;
  run: Run;
  editor: Editor;
  visibleIds?: Set<string> | null;
  focus?: { id: string; token: number } | null;
}) {
  const services = useServices();
  const databaseId = services.library.current()?.databaseId ?? '';
  const store = useDraftStore(databaseId);
  const box = useDraftBox<TagDraftPayload>(store, 'tag');
  const [editing, setEditing] = useState<{
    id?: string;
    category: TagCategory;
    name: string;
    aliases: string;
  } | null>(null);
  const [filter, setFilter] = useState<'all' | TagCategory>('all');
  // 搜索期间忽略类别筛选：否则命中项可能被 filter 挡掉，列表显示为空但右侧已打开
  const list = visibleIds
    ? snapshot.tags.filter((tag) => visibleIds.has(tag.id))
    : snapshot.tags.filter((tag) => filter === 'all' || tag.category === filter);

  const startNew = () => {
    box.start();
    setEditing({ category: 'character', name: '', aliases: '' });
  };
  const openDraft = (id: string) => {
    const draft = box.open(id);
    if (!draft) return;
    const payload = (draft.payload as TagDraftPayload | undefined) ?? {
      category: 'character',
      name: '',
      aliases: '',
    };
    setEditing({ category: payload.category, name: payload.name, aliases: payload.aliases });
  };

  const draftPayload = useMemo<TagDraftPayload | null>(
    () =>
      editing && !editing.id
        ? { category: editing.category, name: editing.name, aliases: editing.aliases }
        : null,
    [editing],
  );
  useFocusJump(focus, (id) => {
    const tag = snapshot.tags.find((item) => item.id === id);
    if (tag) {
      setEditing({
        id: tag.id,
        category: tag.category,
        name: tag.name,
        aliases: tag.aliases?.join('，') ?? '',
      });
    }
  });

  const { error: draftError } = useDraftAutosave({
    store,
    draftId: box.draftId,
    kind: 'tag',
    label: editing?.name.trim() || '未命名标签',
    payload: draftPayload,
    enabled: Boolean(draftPayload) && editing?.id === undefined,
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <button type="button" className={primaryClass} onClick={startNew}>
          新建标签
        </button>
        <DraftList
          drafts={box.drafts}
          selectedId={box.draftId}
          onOpen={(draft) => openDraft(draft.id)}
          onDelete={(id) => {
            const wasOpen = box.draftId === id;
            box.discard(id);
            if (wasOpen) setEditing(null);
          }}
        />
        <select
          className={inputClass}
          value={visibleIds ? 'all' : filter}
          onChange={(event) => setFilter(event.target.value as 'all' | TagCategory)}
        >
          <option value="all">全部类别</option>
          <option value="character">角色</option>
          <option value="plot">情节</option>
          <option value="series">系列</option>
          <option value="general">通用</option>
        </select>
        <PanelList
          items={list}
          empty="没有匹配的标签。"
          selectedId={editing?.id ?? null}
          onSelect={(tag: Tag) =>
            setEditing({
              id: tag.id,
              category: tag.category,
              name: tag.name,
              aliases: tag.aliases?.join('，') ?? '',
            })
          }
          render={(tag) => (
            <>
              <span className="truncate">{tag.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {TAG_CATEGORY_LABEL[tag.category]}
              </span>
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
                aliases: editing.aliases
                  .split(/[，,、\n]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              });
            }, '标签已保存');
            if (box.draftId) box.discard(box.draftId);
            setEditing(null);
          }}
        >
          {draftError ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              草稿未保存：{draftError}
            </p>
          ) : null}
          <Field label="类别">
            <select
              className={inputClass}
              value={editing.category}
              onChange={(event) =>
                setEditing({ ...editing, category: event.target.value as TagCategory })
              }
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

function ImagesPanel({
  snapshot,
  run,
  editor,
  visibleIds = null,
  focus = null,
}: {
  snapshot: DBSnapshot;
  run: Run;
  editor: Editor;
  visibleIds?: Set<string> | null;
  focus?: { id: string; token: number } | null;
}) {
  const services = useServices();
  const [kind, setKind] = useState<ImageKind>('cover');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { kind: ImageKind; caption: string }>>({});
  const loaded = services.library.current();
  const toUrl = (file: string) =>
    loaded ? services.platform.assets.toUrl(services.platform.paths.join(loaded.dir, file)) : '';
  const visibleImages = visibleIds
    ? snapshot.images.filter((image) => visibleIds.has(image.id))
    : snapshot.images;

  useFocusJump(focus, (id) => {
    document
      .querySelector(`[data-image-id="${id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  return (
    <div className="flex flex-col gap-5">
      <form
        className="grid gap-4 rounded-xl border border-accent/30 bg-accent-soft/20 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!file) return;
          setBusy(true);
          void run(async () => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const ext = file.name.split('.').pop() ?? 'bin';
            await editor.saveImage({ bytes, ext, kind, caption });
            setFile(null);
            setCaption('');
          }, '图片已上传').finally(() => setBusy(false));
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">新增图片</h3>
          <span className="text-xs text-muted-foreground">
            上传后会出现在下方列表，可继续修改类型与配文。
          </span>
        </div>
        <ImageFilePicker file={file} disabled={busy} onChange={setFile} />

        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
          <Field label="类型">
            <select
              className={inputClass}
              value={kind}
              onChange={(event) => setKind(event.target.value as ImageKind)}
            >
              {IMAGE_KINDS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="配文">
            <input
              className={inputClass}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </Field>
          <button
            type="submit"
            className={`${primaryClass} disabled:cursor-not-allowed`}
            disabled={busy || file === null}
          >
            {busy ? '上传中…' : '上传图片'}
          </button>
        </div>
      </form>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleImages.length === 0 ? (
          <li className="col-span-full px-4 py-8 text-center text-sm text-muted-foreground">
            没有匹配的图片。
          </li>
        ) : null}
        {visibleImages.map((image) => {
          const draft = drafts[image.id] ?? { kind: image.kind, caption: image.caption ?? '' };
          return (
            <li
              key={image.id}
              data-image-id={image.id}
              className="flex gap-3 rounded-xl border border-border bg-surface/60 p-3"
            >
              <img
                src={toUrl(image.file)}
                alt={image.caption ?? image.id}
                className="h-24 w-16 shrink-0 rounded object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="truncate text-xs text-muted-foreground">{image.file}</span>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  value={draft.kind}
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [image.id]: { ...draft, kind: event.target.value as ImageKind },
                    })
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
                  onChange={(event) =>
                    setDrafts({ ...drafts, [image.id]: { ...draft, caption: event.target.value } })
                  }
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-strong"
                    onClick={() =>
                      void run(async () => {
                        await editor.updateImage(image.id, {
                          kind: draft.kind,
                          caption: draft.caption,
                        });
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

export interface FeaturedDraftPayload {
  targetType: 'article' | 'series';
  targetId: string;
  rows: Recommendation[];
}

function FeaturedPanel({
  snapshot,
  run,
  editor,
  visibleIds = null,
  focus = null,
}: {
  snapshot: DBSnapshot;
  run: Run;
  editor: Editor;
  visibleIds?: Set<string> | null;
  focus?: { id: string; token: number } | null;
}) {
  const services = useServices();
  const databaseId = services.library.current()?.databaseId ?? '';
  const store = useDraftStore(databaseId);
  const box = useDraftBox<FeaturedDraftPayload>(store, 'featured');
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
    const entry = snapshot.featured.find(
      (item) => item.targetType === type && item.targetId === id,
    );
    setRows(
      entry && entry.recommendations.length > 0
        ? entry.recommendations
        : [{ author: '', text: '' }],
    );
  };

  const startDraft = () => {
    box.start();
    setTargetId('');
    setRows([{ author: '', text: '' }]);
  };
  const openDraft = (id: string) => {
    const draft = box.open(id);
    if (!draft) return;
    const payload = draft.payload as FeaturedDraftPayload | undefined;
    if (!payload) return;
    setTargetType(payload.targetType);
    setTargetId(payload.targetId);
    setRows(payload.rows.length > 0 ? payload.rows : [{ author: '', text: '' }]);
  };

  const draftPayload = useMemo<FeaturedDraftPayload>(
    () => ({ targetType, targetId, rows }),
    [targetType, targetId, rows],
  );
  const visibleFeatured = visibleIds
    ? snapshot.featured.filter((entry) => visibleIds.has(`${entry.targetType}:${entry.targetId}`))
    : snapshot.featured;

  useFocusJump(focus, (id) => {
    const [targetType, ...rest] = id.split(':');
    const targetId = rest.join(':');
    if ((targetType === 'article' || targetType === 'series') && targetId) {
      setTargetType(targetType);
      setTargetId(targetId);
      const entry = snapshot.featured.find(
        (item) => item.targetType === targetType && item.targetId === targetId,
      );
      setRows(
        entry && entry.recommendations.length > 0
          ? entry.recommendations
          : [{ author: '', text: '' }],
      );
    }
  });

  const { error: draftError } = useDraftAutosave({
    store,
    draftId: box.draftId,
    kind: 'featured',
    label: targetId ? `推荐语 ${targetId}` : '未选目标的推荐语',
    payload: draftPayload,
    enabled: Boolean(box.draftId),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={startDraft}>
          新建推荐语草稿
        </button>
        {box.drafts.map((draft) => (
          <span
            key={draft.id}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              box.draftId === draft.id
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border'
            }`}
          >
            <button type="button" onClick={() => openDraft(draft.id)}>
              草稿：{draft.label}
            </button>
            <button
              type="button"
              aria-label={`删除草稿 ${draft.label}`}
              onClick={() => box.discard(draft.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {draftError ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          草稿未保存：{draftError}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface/60">
        {visibleFeatured.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            {visibleIds ? '没有匹配的推荐语。' : '还没有推荐语。'}
          </li>
        ) : null}
        {visibleFeatured.map((entry) => {
          const title =
            entry.targetType === 'article'
              ? snapshot.articles.find((article) => article.id === entry.targetId)?.title
              : snapshot.series.find((series) => series.id === entry.targetId)?.title;
          return (
            <li
              key={`${entry.targetType}:${entry.targetId}`}
              className="flex items-start gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{title ?? `${entry.targetId}（目标缺失）`}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.targetType === 'article' ? '文章' : '系列'} ·{' '}
                  {entry.recommendations.length} 条推荐语
                </p>
              </div>
              <button
                type="button"
                className={buttonClass}
                onClick={() => pick(entry.targetType, entry.targetId)}
              >
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
            .map((row) =>
              row.author ? { author: row.author, text: row.text } : { text: row.text },
            );
          if (!targetId || cleaned.length === 0) return;
          void run(async () => {
            await editor.saveFeatured(targetType, targetId, cleaned);
          }, '推荐语已保存');
          if (box.draftId) box.discard(box.draftId);
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
            <select
              className={inputClass}
              value={targetId}
              onChange={(event) => pick(targetType, event.target.value)}
            >
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
                onChange={(event) =>
                  setRows(
                    rows.map((item, i) =>
                      i === index ? { ...item, author: event.target.value } : item,
                    ),
                  )
                }
              />
              <input
                className={inputClass}
                value={row.text}
                placeholder="推荐语"
                onChange={(event) =>
                  setRows(
                    rows.map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    ),
                  )
                }
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
          <button
            type="button"
            className={buttonClass}
            onClick={() => setRows([...rows, { author: '', text: '' }])}
          >
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

export interface CreditsDraftPayload {
  rows: CreditsEntry[];
}

type CreditsRow = CreditsEntry & { key: string };

const newCreditsKey = (): string => `credit-${Math.random().toString(36).slice(2, 10)}`;
const withCreditsKeys = (entries: readonly CreditsEntry[]): CreditsRow[] =>
  entries.map((entry) => ({ ...entry, key: newCreditsKey() }));

function CreditsPanel({
  snapshot,
  run,
  editor,
  visibleIds = null,
  focus = null,
}: {
  snapshot: DBSnapshot;
  run: Run;
  editor: Editor;
  visibleIds?: Set<string> | null;
  focus?: { id: string; token: number } | null;
}) {
  const services = useServices();
  const databaseId = services.library.current()?.databaseId ?? '';
  const store = useDraftStore(databaseId);
  const box = useDraftBox<CreditsDraftPayload>(store, 'credits');
  // 行需要稳定的 React key：数组中用下标做 key，删除/上移时输入框状态会串行
  const [rows, setRows] = useState<CreditsRow[]>(() => withCreditsKeys(snapshot.credits));
  // 鸣谢是"整表编辑"：过滤会让保存丢掉未显示的行，所以搜索时只高亮命中行、不裁剪表单
  const matched = (index: number): boolean => !visibleIds || visibleIds.has(`credits:${index}`);

  useFocusJump(focus, (id) => {
    const index = id.slice('credits:'.length);
    document
      .querySelector(`[data-credits-index="${index}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  const move = (index: number, delta: number) => {
    const next = [...rows];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
    setRows(next);
  };

  const openDraft = (id: string) => {
    const draft = box.open(id);
    if (!draft) return;
    const payload = draft.payload as CreditsDraftPayload | undefined;
    setRows(withCreditsKeys(payload?.rows.length ? payload.rows : [{ name: '' }]));
  };

  const draftPayload = useMemo<CreditsDraftPayload>(() => ({ rows }), [rows]);
  const { error: draftError } = useDraftAutosave({
    store,
    draftId: box.draftId,
    kind: 'credits',
    label: '鸣谢草稿',
    payload: draftPayload,
    enabled: Boolean(box.draftId),
  });

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
        if (box.draftId) box.discard(box.draftId);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            box.start();
            setRows(withCreditsKeys([{ name: '' }]));
          }}
        >
          新建鸣谢草稿
        </button>
        {box.drafts.map((draft) => (
          <span
            key={draft.id}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              box.draftId === draft.id
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border'
            }`}
          >
            <button type="button" onClick={() => openDraft(draft.id)}>
              {draft.label}
            </button>
            <button
              type="button"
              aria-label={`删除草稿 ${draft.label}`}
              onClick={() => box.discard(draft.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {draftError ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          草稿未保存：{draftError}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">顺序即展示顺序，用 ↑↓ 调整。</p>
      {visibleIds ? (
        <p className="text-xs text-muted-foreground">
          搜索中：仅高亮匹配的鸣谢行；鸣谢是整表编辑，保存仍会写入全部行。
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div
          key={row.key}
          data-credits-index={index}
          className={`grid gap-2 sm:grid-cols-[10rem_8rem_minmax(0,1fr)_minmax(0,1fr)_auto] ${
            matched(index) && visibleIds ? 'rounded-lg ring-2 ring-[var(--ring)]' : ''
          }`}
        >
          <input
            className={inputClass}
            value={row.name}
            placeholder="名字"
            onChange={(event) =>
              setRows(
                rows.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)),
              )
            }
          />
          <input
            className={inputClass}
            value={row.role ?? ''}
            placeholder="角色"
            onChange={(event) =>
              setRows(
                rows.map((item, i) => (i === index ? { ...item, role: event.target.value } : item)),
              )
            }
          />
          <input
            className={inputClass}
            value={row.link ?? ''}
            placeholder="链接"
            onChange={(event) =>
              setRows(
                rows.map((item, i) => (i === index ? { ...item, link: event.target.value } : item)),
              )
            }
          />
          <input
            className={inputClass}
            value={row.note ?? ''}
            placeholder="备注"
            onChange={(event) =>
              setRows(
                rows.map((item, i) => (i === index ? { ...item, note: event.target.value } : item)),
              )
            }
          />
          <div className="flex gap-1">
            <button
              type="button"
              className={buttonClass}
              onClick={() => move(index, -1)}
              aria-label="上移"
            >
              ↑
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => move(index, 1)}
              aria-label="下移"
            >
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
        <button
          type="button"
          className={buttonClass}
          onClick={() => setRows([...rows, { name: '', key: newCreditsKey() }])}
        >
          添加一行
        </button>
        <button type="submit" className={primaryClass}>
          保存鸣谢
        </button>
      </div>
    </form>
  );
}
