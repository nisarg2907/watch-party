import { User } from '@watchparty/shared'

interface SidebarProps {
  users: User[]
}

export const Sidebar = ({ users }: SidebarProps) => {
  return (
    <aside className="w-full lg:w-80 flex flex-col gap-3 lg:gap-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 sm:p-4 shadow-sm">
        <h2 className="text-xs sm:text-sm font-semibold text-slate-200 mb-2 sm:mb-3">
          Participants ({users.length})
        </h2>
        <div className="space-y-2 max-h-[200px] lg:max-h-none overflow-y-auto">
          {users.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-3 sm:py-4">Waiting for others to join...</p>
          ) : (
            users.map((user) => (
              <div
                key={user.socketId}
                className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-2.5 sm:px-3 py-1.5 sm:py-2"
              >
                <div className="h-2 w-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="text-xs sm:text-sm text-slate-200 truncate">{user.username}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  )
}
