import type { Tag, TagCategory } from '@tpr/schema';
import { CreatablePicker } from './CreatablePicker.js';

export interface TagPickerProps {
  title: string;
  category: TagCategory;
  /** 当前数据库里同类别（或全部）的候选标签 */
  options: Tag[];
  value: string[];
  onChange(next: string[]): void;
  /** 新建（或复用）一个标签，返回 id；`created=false` 表示命中了已有名称/别名 */
  onCreate(name: string): Promise<{ id: string; created: boolean }>;
}

/**
 * 可新建的标签选择器：过滤 + 勾选 + 输入即新建。
 * 新建成功后会把新 id 直接勾进当前表单，不需要先保存文章。
 */
export function TagPicker({ title, category, options, value, onChange, onCreate }: TagPickerProps) {
  return (
    <CreatablePicker
      title={title}
      options={options.map((tag) => ({ id: tag.id, name: tag.name, aliases: tag.aliases }))}
      value={value}
      onChange={onChange}
      onCreate={onCreate}
      placeholder="搜索已有标签，或输入新名称后点「新建」"
      emptyHint="还没有可选标签，直接在输入框里新建即可。"
      noticeFor={(name, created, matched) =>
        created
          ? `已新建${category === 'character' ? '角色' : '情节'}标签「${name}」`
          : `已复用已有标签「${matched ?? name}」`
      }
    />
  );
}
