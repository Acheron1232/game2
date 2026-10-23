"""Selected October expansion, batch 1. Rigid painted surfaces, held weapons, no hero subdivision."""
import math
from mathutils import Vector, Matrix
import chunky as c
import humanoid
from kit import Model
import _buildings as b
from _painted_units import PaintedModel, body, shaft, replace_action
from _expansion_props import foundry_golem, FoundryModel
from weapon_pose import aim_weapon


class SelectedPainted(PaintedModel):
    def _uv_into_slot(self,mesh,slot,mode="box",back=None,frame=None,sub=None):
        # Equipment samples the bronze/leather band, excluding the optional fur patch.
        if slot.endswith("__weapon_b") and sub is None: sub=(.02,.98,.52,.98)
        return super()._uv_into_slot(mesh,slot,mode,back,frame,sub)


def box(m, at, size, slot, bone="root", rot=(0,0,0), bevel=.08):
    return m.part("box",size,at=at,slot=slot,bone=bone,rot=rot,bevel=bevel)


def ring(m, at, size, slot, bone="weapon", rot=(90,0,0)):
    return m.part("torus",size,at=at,slot=slot,bone=bone,rot=rot,segments=10,rings=4,profile=.18)


def shield(m, s, side="L", large=False):
    p=Vector(m.joints["forearm."+side])+Vector((.08,-.17,-.12))
    # Physical rim and back straps use metal/leather, front uses its own painted panel.
    box(m,tuple(p),(.62 if large else .43,.12,.86 if large else .56),s.weapon_b,"forearm."+side,bevel=.15)
    box(m,tuple(p+Vector((0,-.067,0))),(.53 if large else .35,.02,.76 if large else .47),s.team,"forearm."+side,bevel=.1)


def unit(name):
    golem=name in ("bulwark_golem","siege_golem")
    if golem:
        m=foundry_golem(name,SelectedPainted)
        import unitkit as u
        s=u.Slots(name)
    else:
        m=SelectedPainted(name)
        s=body(m,mage=name in ("null_warden","lantern_novice","veil_sister"))
    g=Vector(c.grip_point(m,"R"))
    m.armature["weapon_grip"]=list(g)
    if name in ("chainbreaker","siege_golem"):
        top=g+Vector((0,0,.78 if golem else .64))
        shaft(m,g+Vector((0,0,-.35)),top,.07,s.weapon_a,sub=(.02,.44,.02,.98))
        box(m,tuple(top),(.72,.30,.30),s.weapon_b,"weapon",bevel=.12)
        for dx in (-.31,.31): box(m,tuple(top+Vector((dx,0,0))),(.13,.37,.40),s.weapon_a,"weapon")
        # Broken chain links are real geometry on the belt, not a repeated torso print.
        for i in range(4): ring(m,(.18+i*.03,-.19,.96-i*.065),(.10,.10,.12),s.weapon_b,"hips",(90,i*45,0))
    elif name=="rune_gunner":
        # The muzzle faces forward in the rest pose; recoil animates the gun bone.
        shaft(m,g+Vector((0,.22,0)),g+Vector((0,-.60,0)),.17,s.weapon_a,sub=(.02,.48,.02,.98))
        box(m,tuple(g+Vector((0,.04,-.09))),(.21,.43,.19),s.weapon_b,"weapon")
        ring(m,tuple(g+Vector((0,-.40,0))),(.24,.24,.08),s.weapon_b)
        m.part("sphere",(.17,.18,.17),at=tuple(g+Vector((0,-.12,.09))),slot=s.weapon_a,sub=(.55,.98,.02,.98),bone="weapon",material="glow",light=False,segments=8,rings=4)
        c.cape(m,slot=s.team,length=.53,width=.48)
    elif name in ("null_warden","lantern_novice","veil_sister"):
        top=g+Vector((0,0,.87))
        shaft(m,g+Vector((0,0,-.7)),top,.045,s.weapon_b)
        if name=="null_warden":
            ring(m,tuple(top),(.38,.38,.07),s.weapon_a)
            ring(m,tuple(top+Vector((0,0,.08))),(.24,.24,.06),s.weapon_b,("weapon"),(90,25,0))
            hx,hy,hz=m.joints["head"]
            for sign in (-1,1):
                a=(sign*.11,hy,hz+.13); e=(sign*.28,hy+.02,hz+.48)
                shaft(m,a,e,.06,s.weapon_b,"head")
                shaft(m,(sign*.2,hy,hz+.30),(sign*.37,hy-.04,hz+.38),.04,s.weapon_b,"head")
        elif name=="lantern_novice":
            box(m,tuple(top+Vector((0,0,-.12))),(.25,.23,.32),s.weapon_a,"weapon")
            for z in (-.31,.08): box(m,tuple(top+Vector((0,0,z))),(.30,.28,.08),s.weapon_b,"weapon")
            hx,hy,hz=m.joints["head"]
            for sign in (-1,1): m.part("sphere",(.16,.09,.18),at=(sign*.16,hy+.015,hz+.12),slot=s.face,sub=(.55,.98,.52,.98),bone="head",segments=8,rings=4)
            # A red panda's striped tail has its own painted back material.
            shaft(m,(0,.14,.85),(0,.45,.48),.19,s.weapon_b,"hips",sub=(.52,.98,.02,.48))
        else:
            ring(m,tuple(top),(.30,.30,.06),s.weapon_a)
            shield(m,s)
        c.cape(m,slot=s.team,length=.83,width=.51)
    elif name=="reliquary_guard":
        top=g+Vector((0,0,.50))
        shaft(m,g+Vector((0,0,-.22)),top,.055,s.weapon_a)
        for a in range(4): box(m,tuple(top),(.30,.10,.28),s.weapon_b,"weapon",rot=(0,0,a*45))
        shield(m,s,large=True)
        # Shrine niche above the shoulders.
        box(m,(0,.17,1.50),(.35,.22,.48),s.weapon_b,"chest")
        box(m,(0,.295,1.52),(.23,.025,.29),s.weapon_a,"chest")
    elif name=="banner_captain":
        shaft(m,g,g+Vector((0,0,.63)),.07,s.weapon_a)
        box(m,tuple(g+Vector((0,0,.10))),(.28,.07,.055),s.weapon_b,"weapon")
        shaft(m,(-.24,.18,.67),(-.24,.18,2.18),.045,s.weapon_b,"chest")
        box(m,(.03,.19,1.89),(.50,.035,.55),s.team,"chest",bevel=0)
        shield(m,s)
    elif name=="bulwark_golem":
        shield(m,s,large=True)
        # A second massive stone rim makes the silhouette visibly defensive.
        p=Vector(m.joints["forearm.L"])+Vector((.08,-.17,-.12))
        for dx in (-.33,.33): box(m,tuple(p+Vector((dx,0,0))),(.12,.21,.94),s.weapon_b,"forearm.L")
    if golem:
        # Replace generic golem actions only where the held tool needs an explicit swing.
        pass
    else: humanoid.animations(m,style="caster" if m.robed else "melee",weight=1.25 if name=="chainbreaker" else 1)
    if name in ("chainbreaker","siege_golem","reliquary_guard","banner_captain"):
        for clip in ("attack","attack2","cast"):
            replace_action(m,clip,40,{
                "chest":[(1,(0,0,0)),(12,(8,0,-13)),(21,(-12,0,16)),(40,(0,0,0))],
                "upper_arm.R":[(1,(0,0,0)),(12,(-65,0,-10)),(21,(50,0,5)),(40,(0,0,0))],
                "forearm.R":[(1,(0,0,0)),(12,(20,0,0)),(21,(-10,0,0)),(40,(0,0,0))],
            })
            aim_weapon(m,clip,g,[(1,0),(12,-45),(21,78),(29,60),(40,0)])
    elif name=="rune_gunner":
        for clip in ("attack","attack2","cast"):
            replace_action(m,clip,40,{"weapon":[(1,(0,0,0)),(13,(-12,0,0)),(18,(0,0,0)),(40,(0,0,0))],"chest":[(1,(0,0,0)),(13,(7,0,0)),(25,(0,0,0)),(40,(0,0,0))]})
    m.socket("weapon",tuple(g+Vector((0,-.4,.1))),"weapon")
    return m


class Structure(FoundryModel):
    def __init__(self,name):
        Model.__init__(self,name,skin="golem_foundry_skin")
        self.mapping_bone="root"; self.local_inverse=Matrix.Identity(4)


def structure(name):
    m=Structure(name)
    m.skeleton({"root":((0,0,0),(0,0,.5),None),"mechanism":((0,0,1.5),(0,0,2),"root")})
    m.joints={"root":(0,0,0)}; m.height=3.5
    def q(at,size,slot="stone",**kw): return box(m,at,size,slot,**kw)
    if name.endswith("wall"):
        tier={"timber_wall":1,"stone_wall":2,"reinforced_wall":3}[name]
        m.height=1.6+tier*.12
        q((0,0,.12),(2,.8,.24),"foundation")
        if tier==1:
            for i in range(7):
                x=-.84+i*.28
                q((x,0,.85),(.24,.30,1.5),"wood")
                m.part("cone",(.24,.30,.28),at=(x,0,1.74),slot="wood",bone="root",segments=4)
            for z in (.5,1.15): q((0,.18,z),(1.96,.13,.12),"iron")
        else:
            q((0,0,.87),(1.96,.54,1.5),"wall")
            for i in range(5): q((-.8+i*.4,0,1.75),(.30,.61,.35),"stone")
            if tier==3:
                for x in (-.74,0,.74): q((x,-.30,.98),(.15,.15,1.49),"iron")
                for z in (.48,1.4):q((0,-.32,z),(1.98,.14,.16),"brass")
    elif name in ("bulwark_hall","repair_post","rally_bastion"):
        hall=name=="bulwark_hall"; w=3.8 if hall else 2.6; d=3 if hall else 1.9
        q((0,0,.15),(w+.3,d+.3,.30),"foundation")
        q((0,.5,1),(w,.9,1.7),"wall")
        for x in (-w*.44,w*.44): q((x,-d*.4,1),(.22,.22,1.8),"wood")
        b.gable_roof(m,w,d,.75,1.85,"roof")
        if hall:
            q((0,-.02,1),(.95,.15,1.5),"door")
            q((0,-.20,2.20),(.82,.12,.94),"iron")
            q((0,-.27,2.20),(.65,.025,.75),"banner")
            for sign in (-1,1):
                q((sign*1.3,-1.12,.77),(.15,.16,1.22),"wood")
                for z in (.5,.85,1.2): q((sign*1.3,-1.23,z),(.47,.06,.27),"iron")
        elif name=="repair_post":
            q((0,-.32,.80),(1.8,.72,.16),"wood")
            for x in (-.7,.7): q((x,-.32,.45),(.17,.53,.67),"wood")
            for i in range(3): q((-.5+i*.5,-.38,.95),(.26,.4,.16),"iron",rot=(0,0,i*17))
            q((1,-.6,.5),(.44,.54,.68),"stone")
        else:
            for x in (-.7,.7):q((x,-.2,.40),(.58,1.15,.23),"banner")
            q((0,-1,.50),(2.65,.32,.68),"wall")
        for x in (-w*.35,w*.35):q((x,-.08,1.55),(.35,.04,.65),"banner")
    elif name=="pitch_basin":
        m.height=.6
        q((0,0,.09),(2.1,2.1,.18),"foundation")
        q((0,0,.19),(1.8,1.8,.07),"iron")
        for x in (-1,1):q((x,0,.27),(.16,2.1,.32),"stone")
        for y in (-1,1):q((0,y,.27),(2.1,.16,.32),"stone")
        q((.6,.4,.35),(.17,1.1,.10),"wood",rot=(0,0,35))
    elif name=="bell_ward":
        q((0,0,.12),(2.2,2.2,.24),"foundation")
        for x in (-.7,.7):q((x,0,1.15),(.3,.36,2.2),"stone")
        q((0,0,2.3),(1.8,.44,.26),"wood")
        b.gable_roof(m,2,1.8,.55,2.4,"roof")
        m.part("lathe",(1,1,1),profile=[(.62,0),(.52,.15),(.38,.65),(.20,.82)],at=(0,0,1.15),slot="brass",bone="mechanism",segments=12)
        shaft(m,(0,0,1.02),(0,0,1.57),.10,"iron","mechanism")
    else:
        q((0,0,.14),(1.8,1.8,.28),"foundation")
        if name=="shield_pylon":
            q((0,0,.72),(.82,.80,1.12),"iron")
            m.part("box",(1.15,.13,1.4),at=(0,-.15,1.62),slot="iron",tint="#55dfff",bone="root",material="glow",light=False)
            for x in (-.65,.65):q((x,.04,.96),(.25,.40,.9),"brass")
        elif name=="wind_totem":
            q((0,0,1.1),(.5,.5,1.95),"wood")
            for z in (1,1.55,2.1):
                q((0,0,z),(1.5,.16,.20),"brass",bone="mechanism",rot=(0,0,z*38))
                q((.5,0,z-.16),(.18,.04,.46),"banner",bone="mechanism")
        else:
            q((0,0,1.10),(.70,.70,1.95),"wall")
            m.part("loft",1,profile=[(0,0,1.8,.08,.08),(0,0,2.05,.54,.54),(0,0,2.8,.02,.02)],slot="iron",tint="#66dfff",bone="root",segments=6,material="glow",light=False)
            for z in (1.7,2.15):ring(m,(0,0,z),(1.0,1.0,.1),"brass","root",(0,0,0))
            if name=="chain_spire":
                for a in range(3):
                    t=a*math.pi*2/3
                    shaft(m,(0,0,1.7),(math.cos(t)*.75,math.sin(t)*.75,2.2),.12,"brass","root")
    m.action("idle",90,{"mechanism":[(1,(0,0,-3)),(45,(0,0,3)),(90,(0,0,-3))]})
    m.socket("effect",(0,0,1.8),"root")
    return m
