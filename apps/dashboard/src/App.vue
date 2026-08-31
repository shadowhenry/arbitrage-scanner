<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useDashboardFeed } from './feed.js';
import FundingMatrixPage from './pages/FundingMatrixPage.vue';
import MarketExplorerPage from './pages/MarketExplorerPage.vue';
import OpportunitiesPage from './pages/OpportunitiesPage.vue';
import OpportunityDetailPage from './pages/OpportunityDetailPage.vue';
import OverviewPage from './pages/OverviewPage.vue';
import SimulationResultsPage from './pages/SimulationResultsPage.vue';
import StrategyPerformancePage from './pages/StrategyPerformancePage.vue';
import type { OpportunityRow } from './types.js';

type Page = 'overview'|'funding'|'opportunities'|'detail'|'markets'|'simulations'|'performance';
const validPages: readonly Page[] = ['overview','funding','opportunities','detail','markets','simulations','performance'];
const menu = [
  {id:'overview',label:'Overview',icon:'⌂'}, {id:'funding',label:'Funding Matrix',icon:'⌁'},
  {id:'opportunities',label:'Opportunities',icon:'⇄'}, {id:'markets',label:'Market Explorer',icon:'◎'},
  {id:'simulations',label:'Simulation Results',icon:'▥'}, {id:'performance',label:'Strategy Performance',icon:'↗'},
] as const;
const { snapshot, opportunities, status, lastUpdate, socketUrl } = useDashboardFeed();
const initialHash = location.hash.slice(1).split('/')[0];
const activePage = ref<Page>(validPages.includes(initialHash as Page) ? initialHash as Page : 'overview');
const selected = ref<OpportunityRow>();
const mobileNav = ref(false);

function navigate(page:string):void { activePage.value=page as Page; location.hash=page; mobileNav.value=false; }
function selectOpportunity(row:OpportunityRow):void { selected.value=row; activePage.value='detail'; location.hash=`detail/${row.id}`; }
function syncHash():void { const [page,id]=location.hash.slice(1).split('/'); if(validPages.includes(page as Page)){activePage.value=page as Page;if(page==='detail'&&id)selected.value=opportunities.value.find(item=>item.id===id);} }
onMounted(()=>window.addEventListener('hashchange',syncHash)); onBeforeUnmount(()=>window.removeEventListener('hashchange',syncHash));
const statusLabel=computed(()=>({live:'Live data',connecting:'Connecting',reconnecting:'Reconnecting',demo:'Demo data'}[status.value]));
</script>
<template><div class="app-shell"><aside class="sidebar" :class="{open:mobileNav}"><div class="brand"><div class="brand-mark">A</div><div><strong>Arbitrage</strong><span>Research Scanner</span></div></div><nav><button v-for="item in menu" :key="item.id" :class="{active:activePage===item.id||(activePage==='detail'&&item.id==='opportunities')}" @click="navigate(item.id)"><span>{{item.icon}}</span>{{item.label}}</button></nav><div class="safety-card"><span>READ ONLY</span><strong>Phase 1 Research</strong><p>Execution and private keys are disabled.</p></div><div class="sidebar-foot"><span class="avatar">RS</span><div><strong>Research workspace</strong><small>30-day experiment</small></div></div></aside><main class="main-shell"><header class="topbar"><button class="mobile-menu" @click="mobileNav=!mobileNav">☰</button><div class="crumb"><span>Arbitrage Scanner</span><b>/</b><strong>{{menu.find(item=>item.id===activePage)?.label ?? 'Opportunity Detail'}}</strong></div><div class="top-actions"><div class="connection" :class="status"><i/>{{statusLabel}}<el-tooltip :content="socketUrl"><span>ⓘ</span></el-tooltip></div><span class="updated">Updated {{lastUpdate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}}</span><div class="phase-pill">NO EXECUTION</div></div></header><div class="page-wrap"><OverviewPage v-if="activePage==='overview'" :snapshot="snapshot" :opportunities="opportunities" @select="selectOpportunity" @navigate="navigate"/><FundingMatrixPage v-else-if="activePage==='funding'" :rows="snapshot.funding"/><OpportunitiesPage v-else-if="activePage==='opportunities'" :rows="opportunities" @select="selectOpportunity"/><OpportunityDetailPage v-else-if="activePage==='detail'" :opportunity="selected" @back="navigate('opportunities')"/><MarketExplorerPage v-else-if="activePage==='markets'" :rows="snapshot.markets"/><SimulationResultsPage v-else-if="activePage==='simulations'" :rows="snapshot.simulations"/><StrategyPerformancePage v-else :rows="snapshot.strategies"/></div></main></div></template>
