import type {MobileAppModule} from '@jetlinks-mobile-core'
import {jetlinksMobile} from './package.json'
const {id,name,templateCodes}=jetlinksMobile
const entryPath=`/applications/${id}`
export default {id,name,templateCodes,entryPath,getRoutes:()=>[{path:entryPath,name:`${id}:entry`,meta:{title:name},component:()=>import('./mobile/shell/ModuleRoot.vue'),children:[{path:'view',name:`${id}:view`,component:{render:()=>null}}]}]} satisfies MobileAppModule
