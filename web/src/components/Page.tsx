import { ReactNode } from "react";
import { TopBar } from "./TopBar";

export function Page({ title, crumb, children }: { title: string; crumb?: string; children: ReactNode }) {
  return (
    <>
      <TopBar title={title} crumb={crumb} />
      <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6">{children}</div>
    </>
  );
}
