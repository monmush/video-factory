import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="mx-auto mt-32 max-w-md text-center">
      <p className="text-muted-foreground">Không tìm thấy nội dung này.</p>
      <Link to="/" className="mt-4 inline-block text-primary hover:underline">
        Về trang đầu
      </Link>
    </div>
  );
}
