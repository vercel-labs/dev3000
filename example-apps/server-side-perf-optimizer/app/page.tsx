import AccountConsole from "./account-console";
import { getWorkspaceSnapshot } from "./data";
import ActivityPanel from "../components/activity-panel";
import AccountHeader from "../components/account-header";

export default async function Home() {
  const snapshot = await getWorkspaceSnapshot();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-14">
      <div className="space-y-8">
        <AccountHeader />
        <ActivityPanel />
        <AccountConsole snapshot={snapshot} />
      </div>
    </main>
  );
}
