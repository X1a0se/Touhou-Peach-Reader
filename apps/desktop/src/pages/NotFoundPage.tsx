import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="flex flex-col items-start gap-3">
      <h2 className="text-xl font-medium">页面不存在</h2>
      <p className="text-sm text-muted-foreground">这个地址还没有对应的页面。</p>
      <Link to="/" className="text-sm underline underline-offset-2">
        回到首页
      </Link>
    </section>
  );
}
