import Link from "next/link";

import type { CategorySummary } from "@/lib/queries/forum";

/**
 * Left rail from the design. Server-rendered plain links, so it doubles as the
 * site's internal linking structure — a crawler reaches every category hub from
 * any page without executing JS.
 */
export function CategoryNav({
  categories,
  activeSlug,
}: {
  categories: CategorySummary[];
  activeSlug?: string;
}) {
  return (
    <nav
      aria-label="Categories"
      className="flex flex-row gap-1.5 overflow-x-auto px-3 py-2 md:w-54 md:shrink-0 md:flex-col md:overflow-visible md:px-3 md:py-5"
    >
      <Link
        href="/"
        className={`flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap ${
          activeSlug === undefined
            ? "text-text font-medium"
            : "text-text-secondary hover:bg-hover-bg"
        }`}
      >
        <span
          className={`hidden h-3.5 w-0.5 rounded-sm md:block ${
            activeSlug === undefined ? "bg-accent" : "bg-transparent"
          }`}
        />
        All Spaces
      </Link>

      {categories.map((category) => {
        const active = category.slug === activeSlug;
        const childActive = category.children.some((c) => c.slug === activeSlug);
        return (
          <div key={category.id} className="shrink-0">
            <Link
              href={`/c/${category.slug}`}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap ${
                active ? "text-text font-medium" : "text-text-secondary hover:bg-hover-bg"
              }`}
            >
              <span
                className={`hidden h-3.5 w-0.5 rounded-sm md:block ${
                  active ? "bg-accent" : "bg-transparent"
                }`}
              />
              {category.name}
              <span className="text-2xs text-text-secondary ml-auto hidden tabular-nums md:inline">
                {category.threadCount}
              </span>
            </Link>

            {/* Sub-categories expand only for the active branch, matching the
                design, but they remain reachable from the category page itself
                so crawlers still find them. */}
            {(active || childActive) && category.children.length > 0 ? (
              <div className="hidden md:block">
                {category.children.map((child) => (
                  <Link
                    key={child.id}
                    href={`/c/${child.slug}`}
                    className={`block rounded-md py-1.5 pr-2.5 pl-6 text-xs ${
                      child.slug === activeSlug
                        ? "text-accent-text font-medium"
                        : "text-text-secondary hover:bg-hover-bg"
                    }`}
                  >
                    {child.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
