import type { Author } from '@tpr/schema';
import { normalizeName } from '@tpr/schema';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { CreatablePicker } from './CreatablePicker.js';

export interface AuthorPickerProps {
  title: string;
  /** 当前数据库的全部作者（作者与译者共用同一实体） */
  authors: readonly Author[];
  value: string[];
  onChange(next: string[]): void;
}

/**
 * 可新建的作者选择器：作者和译者共用。
 * 判重交给 core 的 `saveAuthor`（归一化名称 + 别名），这里只负责提示"新建"还是"复用"。
 */
export function AuthorPicker({ title, authors, value, onChange }: AuthorPickerProps) {
  const services = useServices();
  const { refresh } = useLibraryContext();

  const create = async (name: string): Promise<{ id: string; created: boolean }> => {
    const key = normalizeName(name);
    const existed = authors.some(
      (author) =>
        normalizeName(author.canonicalName) === key ||
        (author.aliases ?? []).some((alias) => normalizeName(alias) === key),
    );
    const id = await services.editor.saveAuthor({ canonicalName: name, aliases: [] });
    await refresh();
    return { id, created: !existed };
  };

  return (
    <CreatablePicker
      title={title}
      options={authors.map((author) => ({
        id: author.id,
        name: author.canonicalName,
        aliases: author.aliases,
      }))}
      value={value}
      onChange={onChange}
      onCreate={create}
      placeholder="搜索作者，或输入新名字后点「新建」"
      emptyHint="还没有作者，直接在输入框里新建即可。"
      noticeFor={(name, created, matched) =>
        created ? `已新建作者「${name}」` : `已复用已有作者「${matched ?? name}」`
      }
    />
  );
}
