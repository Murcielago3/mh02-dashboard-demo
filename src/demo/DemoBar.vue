<script setup>
// Floating demo control: switch the viewing identity without logging out, and
// reseed/reset the data. Because demo data is one shared store (not per-user
// scoped like the real backend), switching is just swapping the current user —
// every screen then renders that person's view of the SAME seeded data.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { db, resetDemo } from './db'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const open = ref(false)

const people = computed(() => {
  const order = { admin: 0, project_manager: 1, employee: 2 }
  return db.users
    .filter((u) => u.is_active)
    .slice()
    .sort((a, b) => (order[a.role] - order[b.role]) || a.id - b.id)
})

const currentId = computed(() => {
  const m = /demo-token-(\d+)/.exec(auth.token || '')
  return m ? Number(m[1]) : null
})

const currentUser = computed(() => db.users.find((u) => u.id === currentId.value) || null)

const roleLabel = (role) =>
  role === 'admin' ? 'Admin' : role === 'project_manager' ? 'Project Manager' : 'Employee'

function dashboardFor(role) {
  if (role === 'admin') return '/admin/dashboard'
  if (role === 'project_manager') return '/admin/timesheets'
  return '/employee/dashboard'
}

function viewAs(user) {
  auth.setToken(`demo-token-${user.id}`, user.role)
  auth.user = { ...user }
  open.value = false
  router.push(dashboardFor(user.role))
}

function onReset() {
  if (confirm('Reset the demo? All changes made during this session are discarded and fresh data is generated.')) {
    resetDemo()
  }
}
</script>

<template>
  <div class="demo-bar">
    <button class="demo-toggle" @click="open = !open">
      <span class="dot"></span>
      <span class="demo-label">DEMO</span>
      <span v-if="currentUser" class="who">{{ currentUser.name }}</span>
      <span class="caret">{{ open ? '▾' : '▴' }}</span>
    </button>

    <div v-if="open" class="demo-panel">
      <div class="panel-head">View as</div>
      <div class="people">
        <button
          v-for="p in people"
          :key="p.id"
          class="person"
          :class="{ active: p.id === currentId }"
          @click="viewAs(p)"
        >
          <span class="p-name">{{ p.name }}</span>
          <span class="p-role">{{ roleLabel(p.role) }}</span>
        </button>
      </div>
      <div class="panel-foot">
        <button class="reset" @click="onReset">Reset demo data</button>
        <p class="note">Sample data only. Nothing is saved to a server.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo-bar { position: fixed; right: 16px; bottom: 16px; z-index: 9999; font-family: Inter, sans-serif; }
.demo-toggle {
  display: flex; align-items: center; gap: 8px;
  background: #111827; color: #fff; border: 0; cursor: pointer;
  padding: 9px 14px; border-radius: 999px; font-size: 12px; font-weight: 600;
  box-shadow: 0 6px 20px rgba(0,0,0,.28);
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; }
.demo-label { letter-spacing: .08em; }
.who { opacity: .75; font-weight: 500; }
.caret { opacity: .6; }

.demo-panel {
  position: absolute; right: 0; bottom: 48px; width: 260px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0,0,0,.18); overflow: hidden;
}
.panel-head {
  padding: 10px 14px; font-size: 11px; font-weight: 700; letter-spacing: .06em;
  color: #6b7280; background: #f9fafb; border-bottom: 1px solid #f3f4f6;
}
.people { max-height: 280px; overflow-y: auto; }
.person {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  width: 100%; padding: 9px 14px; background: none; border: 0; cursor: pointer;
  font-size: 13px; text-align: left; color: #111827;
}
.person:hover { background: #f3f4f6; }
.person.active { background: #ecfdf5; font-weight: 600; }
.p-role { font-size: 11px; color: #6b7280; }
.panel-foot { padding: 10px 14px; border-top: 1px solid #f3f4f6; }
.reset {
  width: 100%; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  background: #fff; color: #b91c1c; border: 1px solid #fecaca; border-radius: 8px;
}
.reset:hover { background: #fef2f2; }
.note { margin-top: 8px; font-size: 10.5px; color: #9ca3af; line-height: 1.4; }

@media print { .demo-bar { display: none !important; } }
</style>
