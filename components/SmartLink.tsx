import Link from "next/link";
import { isExternal } from "@/lib/site";

type Props = React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** Next <Link> for internal routes, plain <a> (new tab) for external URLs. */
export function SmartLink({ href, children, ...rest }: Props) {
  if (isExternal(href)) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
  }
  if (href.startsWith("#")) return <a href={href} {...rest}>{children}</a>;
  return <Link href={href} {...rest}>{children}</Link>;
}
