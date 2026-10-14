import Link from "next/link";

export default function LayoutAcceso({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <Link href="/" className="mb-6 text-lg font-semibold">
        Control Diésel
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
    </main>
  );
}
