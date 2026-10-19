import { Button, EmptyState } from '@tpr/ui';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <EmptyState
      icon="🫧"
      title="页面不存在"
      description="这个地址还没有对应的页面。"
      action={
        <Link to="/">
          <Button size="sm">回到首页</Button>
        </Link>
      }
    />
  );
}
