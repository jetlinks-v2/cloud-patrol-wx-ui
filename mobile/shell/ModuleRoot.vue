<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {Button,Empty,Loading} from 'vant'
import {useMobileAppContext,registerMobileAppBack} from '@jetlinks-mobile-core'
import {jetlinksMobile} from '../../package.json'
import BusinessApp from '../App.vue'
import {hostState} from '../transport'
import {patrolProject} from '../projectScope'
import {providePatrolI18n} from '../i18n'
import {bindShell,shellState,shellRequest,shellBack} from './runtime'
import {mountBusinessStyles} from './styles'
import businessCss from '../style.css?inline'
const context=useMobileAppContext(),ready=ref(false),error=ref(''),generation=ref(0)
providePatrolI18n()
let dispose=()=>{},removeStyles=()=>{},unregisterBack=()=>{},attempt=0
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
onMounted(()=>{unregisterBack=registerMobileAppBack(shellBack);removeStyles=mountBusinessStyles([businessCss],'patrol-business');void start()})
onBeforeUnmount(()=>{unregisterBack();attempt++;dispose();patrolProject.value=undefined;hostState.context=undefined;hostState.error=undefined;removeStyles()})
</script>
<template><section class="patrol-business official-module"><Empty v-if="error||shellState.error" :description="error||shellState.error"><Button v-if="!shellState.error" @click="start">重新加载</Button></Empty><BusinessApp v-else-if="ready" :key="generation"/><Loading v-else vertical>正在连接应用</Loading></section></template>
