<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,provide,ref,watch} from 'vue'
import {Button,Empty,Loading} from 'vant'
import {useRoute} from 'vue-router'
import {useMobileAppContext} from '@jetlinks-mobile-core'
import {jetlinksMobile} from '../../package.json'
import BusinessApp from '../App.vue'
import {hostState} from '../transport'
import {patrolProject} from '../projectScope'
import {providePatrolI18n} from '../i18n'
import {bindShell,shellState,shellRequest} from './runtime'
import {mountBusinessStyles} from './styles'
import {mountBusinessViewport} from './viewport'
import businessCss from '../style.css?inline'
const context=useMobileAppContext(),root=ref<HTMLElement>(),ready=ref(false),error=ref(''),generation=ref(0)
providePatrolI18n()
provide('business-popup-target',computed(()=>root.value||'body'))
const route=useRoute()
const scroll=ref<HTMLElement>()
const scrollTop=()=>scroll.value?.scrollTo(0,0)
provide('business-scroll-top',scrollTop)
watch(()=>route.path,scrollTop,{flush:'post'})
let dispose=()=>{},removeStyles=()=>{},removeViewport=()=>{},attempt=0
async function start(){
 const current=++attempt;ready.value=false;error.value='';patrolProject.value=undefined;hostState.context=undefined;hostState.error=undefined
 dispose();dispose=bindShell(context,jetlinksMobile.templateCodes)
 if(shellState.error)return
 try{
  const me=await shellRequest<{user:{id:string;name?:string};permissions?:{id:string;actions:string[]}[]}>('/authorize/me')
  if(current!==attempt)return
  if(!me?.user?.id)throw Error('应用授权未返回有效身份')
  hostState.context={userId:me.user.id,name:me.user.name,applicationId:context.application.value!.id,environmentId:context.project.value!.code,permissions:me.permissions||[]}
  generation.value++;ready.value=true
 }catch(cause){if(current===attempt)error.value=cause instanceof Error?cause.message:'应用加载失败'}
}
watch(()=>[context.project.value?.code,context.application.value?.id,context.application.value?.templateCode],()=>{void start()},{flush:'sync'})
onMounted(()=>{removeViewport=mountBusinessViewport(root.value!);removeStyles=mountBusinessStyles([businessCss],'patrol-business');void start()})
onBeforeUnmount(()=>{attempt++;dispose();patrolProject.value=undefined;hostState.context=undefined;hostState.error=undefined;removeStyles();removeViewport()})
</script>
<template><section ref="root" class="patrol-business official-module"><div ref="scroll" class="business-scroll"><Empty v-if="error||shellState.error" :description="error||shellState.error"><Button v-if="!shellState.error" @click="start">重新加载</Button></Empty><BusinessApp v-else-if="ready" :key="generation"/><Loading v-else vertical>正在连接应用</Loading></div></section></template>

<style scoped>

/* 宿主负责安全区和关闭栏，业务的粘性顶栏、固定操作区和弹窗限制在应用区域内。 */
.official-module {
  position: relative;
  isolation: isolate;
  contain: layout paint;
  height: var(--business-viewport-height, 100dvh);
  min-height: 0;
  overflow: hidden;
  --h5-app-safe-top: 0px;
  --h5-app-safe-bottom: env(safe-area-inset-bottom, 0px);
}
.business-scroll {
  height: 100%;
  overflow: auto;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
}
.official-module :deep(.mobile-patrol) { min-height: 100%; max-width: none; padding-top: 0; padding-bottom: 0; }
.official-module { --patrol-app-safe-top: 0px; }
.official-module :deep(.app-header) { min-height: 58px; padding-top: 0; }
.official-module :deep(.van-popup) { max-height: 100%; }
.official-module :deep(.van-dialog) { top: 50%; max-height: 100%; overflow-y: auto; }
</style>
