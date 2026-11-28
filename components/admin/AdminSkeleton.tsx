export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-lg bg-chip motion-safe:animate-pulse ${className}`} />;
}

function FieldSkeleton({ multiline = false }: { multiline?: boolean }) {
  return <div className="flex min-w-0 flex-col gap-2">
    <SkeletonBlock className="h-4 w-40 max-w-full" />
    <SkeletonBlock className={multiline ? "h-24 w-full rounded-2xl" : "h-12 w-full rounded-2xl"} />
  </div>;
}

export function AdminRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-hidden="true" className="flex flex-col gap-3">
    {Array.from({ length: rows }, (_, index) => <div key={index} className="flex flex-col gap-2 border-t border-line-soft pt-3">
      <SkeletonBlock className="h-4 w-3/4" />
      <SkeletonBlock className="h-4 w-1/2" />
    </div>)}
  </div>;
}

function CardSkeleton({ children }: { children: React.ReactNode }) {
  return <div className="card flex flex-col gap-4 p-5 md:p-6">
    <SkeletonBlock className="h-6 w-48 max-w-full" />
    {children}
  </div>;
}

function PickFormSkeleton() {
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap gap-3">
      <div className="flex-[0_1_140px]"><FieldSkeleton /></div>
      <div className="flex-[1_1_320px]"><FieldSkeleton /></div>
    </div>
    <FieldSkeleton multiline />
    <FieldSkeleton />
    <SkeletonBlock className="h-5 w-3/4" />
    <FieldSkeleton />
    <SkeletonBlock className="h-5 w-2/3" />
    <SkeletonBlock className="h-10 w-full" />
    <SkeletonBlock className="h-12 w-40 rounded-full" />
  </div>;
}

function TestFormSkeleton() {
  return <div className="flex flex-col gap-4">
    <SkeletonBlock className="h-4 w-3/4" />
    <FieldSkeleton />
    <FieldSkeleton multiline />
    <SkeletonBlock className="h-36 w-full rounded-2xl" />
    <FieldSkeleton />
    <SkeletonBlock className="h-11 w-24 rounded-full" />
    <SkeletonBlock className="h-4 w-28" />
    <FieldSkeleton />
    <SkeletonBlock className="h-5 w-3/4" />
    <SkeletonBlock className="h-11 w-40 rounded-full" />
    <SkeletonBlock className="mt-2 h-5 w-40" />
    <AdminRowsSkeleton rows={2} />
  </div>;
}

export function AdminPageSkeleton({ pathname }: { pathname: string }) {
  return <div role="status" aria-busy="true" className="flex flex-col gap-5">
    <span className="sr-only">Staff content is still loading.</span>
    <div aria-hidden="true" className="flex flex-col gap-5">
      {pathname === "/admin/picks" ? <>
        <CardSkeleton><PickFormSkeleton /></CardSkeleton>
        <CardSkeleton><AdminRowsSkeleton rows={2} /></CardSkeleton>
        <CardSkeleton><AdminRowsSkeleton /></CardSkeleton>
      </> : pathname === "/admin/worker" ? <>
        <CardSkeleton><AdminRowsSkeleton rows={4} /></CardSkeleton>
        <CardSkeleton><TestFormSkeleton /></CardSkeleton>
      </> : pathname === "/admin/news-sources" ? <>
        <CardSkeleton><AdminRowsSkeleton rows={4} /></CardSkeleton>
      </> : pathname === "/admin/api-keys" ? (
        <CardSkeleton>
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-2/3" />
          <FieldSkeleton />
          <SkeletonBlock className="h-11 w-40 rounded-full" />
        </CardSkeleton>
      ) : <>
        <CardSkeleton><SkeletonBlock className="h-4 w-3/4" /></CardSkeleton>
        <CardSkeleton><SkeletonBlock className="h-4 w-2/3" /></CardSkeleton>
        <CardSkeleton>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="flex flex-col gap-3 rounded-2xl bg-inset p-3">
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-7 w-16 max-w-full" />
            </div>)}
          </div>
        </CardSkeleton>
        <CardSkeleton><AdminRowsSkeleton /></CardSkeleton>
      </>}
    </div>
  </div>;
}

export function AdminStaffSkeleton({ pathname }: { pathname: string }) {
  return <div className="flex flex-col gap-5">
    <SkeletonBlock className="h-10 w-24" />
    <div aria-hidden="true" className="flex flex-wrap gap-2">
      {["w-24", "w-20", "w-44", "w-32", "w-28"].map((width) => <SkeletonBlock key={width} className={`h-11 rounded-full ${width}`} />)}
    </div>
    <SkeletonBlock className="h-4 w-48" />
    <AdminPageSkeleton pathname={pathname} />
  </div>;
}

export function AdminPanelSkeleton({ pathname }: { pathname: string }) {
  return <div className="page flex flex-col">
    <div aria-hidden="true" className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-4 px-4 py-4 md:px-8">
      <SkeletonBlock className="h-8 w-32" />
      <SkeletonBlock className="h-12 min-w-0 flex-1 rounded-2xl" />
      <SkeletonBlock className="hidden h-11 w-64 rounded-full md:block" />
    </div>
    <main id="main" className="flex-1">
      <div className="mx-auto w-full max-w-[900px] px-4 pb-14 pt-8 md:px-8">
        <AdminStaffSkeleton pathname={pathname} />
      </div>
    </main>
    <div aria-hidden="true" className="border-t border-line-soft">
      <div className="wrap flex flex-col gap-3 pb-10 pt-6">
        <SkeletonBlock className="h-4 w-3/4" />
        <SkeletonBlock className="h-8 w-full" />
      </div>
    </div>
  </div>;
}
