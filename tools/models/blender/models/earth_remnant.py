"""Small invulnerable stone statue. Shares Earth Spirit material without a new atlas."""
from kit import Model
from _expansion_heroes import HeroModel, plate

def build():
    # This prop uses the hero skin but one rigid root, with no hidden character rig.
    m=Model("earth_remnant",skin="earth_spirit_skin")
    m.skeleton({"root":((0,0,0),(0,0,.3),None)})
    m.height=1.4
    for z,w,h in ((.08,.74,.16),(.23,.60,.16),(.46,.39,.35),(.82,.51,.40),(1.13,.31,.31)):
        m.part("box",(w,w*.75,h),at=(0,0,z),slot="head_back",bone="root",bevel=.12,smooth=0)
    for sx in (-1,1):
        m.part("box",(.34,.18,.16),at=(sx*.14,-.24,.86),rot=(0,sx*22,0),slot="arm",bone="root",bevel=.15)
    m.part("box",(.045,.018,.27),at=(0,-.13,1.14),slot="weapon_b",bone="root")
    for sx in (-1,1):m.part("box",(.07,.025,.022),at=(sx*.085,-.13,1.19),slot="extra_b",bone="root",material="glow",light=False)
    m.action("idle",1,{"root":[(1,(0,0,0))]})
    return m
