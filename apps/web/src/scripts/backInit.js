// biome-ignore format: size
addEventListener("popstate",e=>{dispatchEvent(new Event("singularity:back",{cancelable:true}))||e.stopImmediatePropagation()});
