<script setup lang="ts">
import {NoticeBar,Toast} from 'vant'
import {computed,inject,onMounted,ref,watch} from 'vue'
defineOptions({inheritAttrs:false})
const props=defineProps<{message:string;description?:string;type?:string;floating?:boolean;inline?:boolean}>()
const emit=defineEmits<{'update:message':[message:string]}>()
const popupTarget=inject('business-popup-target',ref<HTMLElement|string>('body'))
// 即时错误浮层提示，离线状态、权限说明和待确认结果仍可持续展示。
const feedback=computed(()=>props.floating||props.type==='error')
const content=computed(()=>[props.message,props.description].filter(Boolean).join(' '))
const visible=ref(false)
const refresh=()=>{visible.value=!!content.value&&feedback.value}
watch(()=>[content.value,feedback.value],refresh)
// 挂载后显示，确保组件启动自动关闭计时。
onMounted(refresh)
function dismiss(show:boolean){visible.value=show;if(!show)emit('update:message','')}
</script>
<template>
 <Toast v-if="feedback" :show="visible" :message="content" :teleport="popupTarget" position="middle" :duration="6000" :z-index="10000" close-on-click class="patrol-feedback-toast" :style="{'--van-toast-max-width':'calc(100% - 48px)'}" @update:show="dismiss"><template #message><div role="alert" aria-live="assertive">{{content}}</div></template></Toast>
 <NoticeBar v-if="!feedback||inline" v-bind="$attrs" wrapable :scrollable="false" :color="type==='error'?'#b42318':type==='success'?'#16794c':'#526983'" :background="type==='error'?'#fff1f0':type==='success'?'#edf9f3':'#eef5ff'" :text="content" />
</template>
<style scoped>
.patrol-feedback-toast{width:max-content;max-width:calc(100% - 48px);box-sizing:border-box}
</style>
