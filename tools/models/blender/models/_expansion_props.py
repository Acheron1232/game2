"""B07: a stone foundry and the heavy construct it trains."""
import math
from mathutils import Vector
import chunky as c
import humanoid
import unitkit as u
import _buildings as b
from kit import Model
from _painted_units import PaintedModel
from _expansion_heroes import HeroModel, rod, plate, orb


def foundry_golem(name="foundry_golem", model_class=PaintedModel):
    m=model_class(name); s=u.Slots(m.name); m.bulk=1.6
    humanoid.skeleton(m,height=1.92,shoulders=.39,hips=.19,arm_len=1.18,leg_len=.90,hunch=.4,arm_spread=.7,elbow_bend=.5)
    c.torso(m,front=s.body,back=s.body,waist=(.55,.41),belly=(.72,.48),chest=(.91,.60),shoulders=(.95,.58),neck=(.25,.22),hump=False)
    c.head(m,face=s.face,back=s.face,size=(.34,.31,.30),ears=None)
    for side in ("L","R"):
        c.arm(m,side,skin=s.arm,fore=s.arm,band=None,upper=(.39,.37,.32,.27),forearm=(.28,.38,.32,.25),bracer=False)
        c.fist(m,side,slot=s.foot_hand,size=.15,sub=u.HAND)
        c.leg(m,side,thigh_slot=s.legs,shin_slot=s.legs,foot_slot=s.foot_hand,band=None,thigh=(.31,.33,.24),shin=(.24,.26,.21),boot=1.65,foot_sub=u.FOOT)
        c.shoulder_pad(m,side,slot=s.team,size=1.05,spikes=0)
    c.belt(m,slot=s.weapon_b,size=(.68,.49),height=.16)
    # An actual inset furnace with a protective brass rim.
    m.part("torus",(.34,.34,.11),at=(0,-.31,1.45),rot=(90,0,0),slot=s.weapon_b,bone="chest",segments=12,rings=4,profile=.16)
    m.part("sphere",(.24,.09,.24),at=(0,-.32,1.45),slot=s.weapon_a,bone="chest",segments=10,rings=6,sub=(.55,.98,.02,.98),material="glow",light=False)
    for side in ("L","R"):
        x,y,z=m.joints["upper_arm."+side]
        m.part("cylinder",(.14,.14,.37),at=(x,y+.08,z),rot=(0,90,0),slot=s.weapon_b,bone="upper_arm."+side,segments=8)
    humanoid.animations(m,weight=1.45)
    m.socket("core",(0,-.34,1.45),"chest")
    return m


class FoundryModel(HeroModel):
    # Local prop projections are shared with heroes; buildings keep the lower budget.
    def finish(self): return Model.finish(self)


def golem_foundry():
    m=FoundryModel("golem_foundry")
    m.skeleton({"root":((0,0,0),(0,0,.5),None),"crane":((1.55,.35,2.8),(1.55,.35,3.5),"root")})
    m.joints={"root":(0,0,0)}; m.height=4.8
    def box(at,size,slot,rot=(0,0,0),bone="root",bevel=.08):
        return m.part("box",size,at=at,slot=slot,rot=rot,bone=bone,bevel=bevel)
    box((0,0,.17),(4.35,3.5,.34),"foundation")
    box((-.78,.25,1.13),(2.55,2.7,1.9),"wall")
    b.gable_roof(m,2.55,2.7,.85,2.08,"roof",at=(-.78,.25),overhang=.15)
    box((-.78,-1.16,.94),(1.05,.12,1.52),"door")
    for x in (-1.94,.36):
        box((x,-1.18,1.19),(.19,.22,1.98),"wood")
    box((-.78,-1.22,2.04),(2.6,.25,.2),"wood")
    # Forge chimney and hot, recessed front opening.
    box((-1.38,.91,3.00),(.7,.72,1.45),"stone")
    box((-1.38,.91,3.75),(.85,.87,.19),"iron")
    box((-1.52,-1.15,.65),(.60,.13,.72),"furnace")
    for i in range(4): box((-1.73+i*.14,-1.235,.65),(.032,.05,.66),"iron")
    # Open assembly bay: a clearly recognizable half-built golem under the crane.
    box((1.26,.15,.39),(1.62,1.86,.34),"stone")
    box((1.26,.29,1.25),(.77,.57,.94),"statue_body",bevel=.18)
    for sx in (-1,1):
        box((1.26+sx*.24,.29,.72),(.29,.43,.46),"stone",bevel=.16)
        box((1.26+sx*.24,.15,.52),(.34,.62,.27),"iron",bevel=.14)
        orb(m,(1.26+sx*.52,.29,1.56),(.46,.48,.52),"stone","root",segments=8,rings=5)
        box((1.26+sx*.57,.23,1.12),(.35,.41,.51),"statue_body",rot=(0,sx*12,0),bevel=.2)
    box((1.26,.27,1.95),(.47,.40,.42),"statue_back",bevel=.14)
    box((1.26,.057,1.95),(.40,.025,.32),"statue_face",bevel=0)
    orb(m,(1.26,-.03,1.38),(.23,.08,.24),"glow","root",segments=8,rings=5,glow=True)
    # Timber lifting frame, iron wheel, chain and hook.
    for y in (-.6,.94): box((1.94,y,1.69),(.23,.23,2.95),"crane")
    box((1.54,.17,3.2),(1.35,2.13,.24),"crane")
    box((1.28,.15,3.42),(.20,1.93,.18),"wood",rot=(0,0,0),bone="crane")
    m.part("cylinder",(.57,.57,.14),at=(1.28,-.78,3.4),rot=(90,0,0),slot="iron",bone="crane",segments=12,uv="front")
    for i in range(5):
        m.part("torus",(.095,.095,.095),at=(1.28,-.83,3.08-i*.12),rot=(90 if i%2 else 0,0,0),slot="chain",bone="crane",segments=8,rings=4,profile=.22)
    m.part("torus",(.24,.24,.24),at=(1.28,-.83,2.40),rot=(90,0,0),slot="brass",bone="crane",segments=10,rings=4,profile=.2)
    # Team pennants, with their own clean front panels.
    for x in (-1.88,.22):
        box((x,-1.36,1.81),(.35,.035,.70),"banner",bevel=0)
    # Spare masonry and a pair of ingots by the door.
    for i in range(3):box((-.4+i*.29,-1.51,.34),(.25,.37,.18),"brass",rot=(0,0,i*9))
    m.socket("furnace",(-1.52,-1.25,.65),"root")
    m.socket("core",(1.26,-.08,1.38),"root")
    m.action("idle",90,{"crane":[(1,(0,0,-2)),(45,(0,0,2)),(90,(0,0,-2))]})
    return m
