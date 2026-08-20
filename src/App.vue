<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import GlobalNotifier from './components/GlobalNotifier.vue'
import DemoBar from './demo/DemoBar.vue'
import { useAuthStore } from './stores/auth'

const route = useRoute()
const auth = useAuthStore()
// The demo bar is for signed-in screens only; the login page has its own picker.
const showDemoBar = computed(() => auth.isAuthenticated && route.path !== '/login')
</script>

<template>
  <router-view />
  <GlobalNotifier />
  <DemoBar v-if="showDemoBar" />
</template>
