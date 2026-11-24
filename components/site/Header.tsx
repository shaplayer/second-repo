import { currentUser } from "@/lib/web/request";
import { HeaderView } from "./HeaderView";

export async function Header({ search = true }: { search?: boolean }) {
  return <HeaderView search={search} user={Boolean(await currentUser())} />;
}
