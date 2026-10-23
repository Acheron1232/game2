"""Earth Spirit: painted stone monk, broad silhouette and double stone-ended staff."""
import math
from mathutils import Vector
import bpy
import chunky as c
from _expansion_heroes import HeroModel, anatomy, rod, plate, finish_animations
from weapon_pose import aim_weapon


def build():
    m = HeroModel("earth_spirit")
    anatomy(m, bulk=1.65, height=2.12, head_size=(.40,.35,.43))
    hx,hy,hz=m.joints["head"]
    # Faceted face plates, gold central seam and narrow jade eyes.
    plate(m,(0,hy-.18,hz+.13),(.35,.13,.36),"face","head")
    plate(m,(0,hy-.252,hz+.14),(.045,.014,.37),"weapon_b","head")
    for sx in (-1,1):
        m.part("box",(.105,.025,.027),at=(sx*.095,hy-.254,hz+.19),slot="extra_b",bone="head",material="glow",light=False)
        m.part("torus",(.11,.11,.038),at=(sx*.215,hy,hz+.10),rot=(0,90,0),slot="weapon_b",bone="head",segments=10,rings=4,profile=.22)
    # Real geometric boulder shoulders and stone hands, with separate bronze wrist bands.
    for side,sx in (("L",1),("R",-1)):
        sh,el,wr=[Vector(m.joints[n+"."+side]) for n in ("upper_arm","forearm","hand")]
        for n in range(3):
            p=sh+Vector((sx*(n-1)*.105,.015,.11-abs(n-1)*.04))
            plate(m,p,(.30,.34,.28),"arm","upper_arm."+side,rot=(0,sx*(n-1)*18,0))
        c.limb(m,tuple(el),tuple(wr),[(.36,.32,.29),(.47,.34,.30),(.85,.30,.27),(.94,.28,.25)],slot="extra_a",bone="forearm."+side,segments=12,uv="wrap",smooth=0)
        g=Vector(c.grip_point(m,side))
        for n in range(4): plate(m,g+Vector(((n-1.5)*.085,-.11,-.025)),(.08,.13,.13),"hand","hand."+side)
        # Rock plates down the upper arm, green seam fragments occupy dedicated glow slot.
        for n in range(3):
            p=sh.lerp(el,.22+n*.20)
            plate(m,p,(.34,.33,.17),"arm","upper_arm."+side,rot=(0,sx*12,0))
            m.part("box",(.15,.015,.018),at=tuple(p+Vector((0,-.18,.05))),rot=(0,18*sx,0),slot="extra_b",bone="upper_arm."+side,material="glow",light=False)
    # Olive wrapped shirt, thick woven belt and hanging engraved tablets.
    plate(m,(0,-.27,1.60),(.73,.07,.48),"chest","chest")
    plate(m,(0,.245,1.62),(.81,.07,.51),"back","chest")
    plate(m,(-.08,-.33,1.67),(.24,.07,.73),"cloth","chest",rot=(0,-31,0))
    c.belt(m,slot="extra_a",size=(.83,.59),height=.14)
    plate(m,(0,-.33,1.15),(.24,.09,.22),"weapon_b","hips")
    m.part("box",(.155,.027,.15),at=(0,-.39,1.15),slot="extra_b",bone="hips",bevel=.06,material="glow",light=False)
    c.loincloth(m,slot="cloth",length=.63,width=.46)
    for sx in (-1,1):
        plate(m,(sx*.31,-.27,.90),(.19,.06,.49),"extra_a","hips",rot=(0,sx*17,0))
        rod(m,(sx*.17,-.29,1.88),(sx*.20,-.31,1.61),.022,"weapon_b","chest",segments=8)
        plate(m,(sx*.20,-.33,1.55),(.14,.05,.22),"extra_a","chest")
        # Small team cloth tabs; most of the silhouette retains the reference olive palette.
        plate(m,(sx*.36,.02,1.13),(.09,.15,.14),"team","hips")
    g=Vector(c.grip_point(m,"R")); m.armature["weapon_grip"]=list(g)
    axis=Vector((0,-.10,1)).normalized()
    rod(m,g-axis*.92,g+axis*1.18,.043,"weapon_a","weapon",segments=12)
    for t in (-.78,1.06):
        mid=g+axis*t
        c.limb(m,tuple(mid-axis*.24),tuple(mid+axis*.24),[(0,.20,.20),(.12,.25,.25),(.88,.25,.25),(1,.20,.20)],slot="weapon_a",bone="weapon",segments=12,uv="wrap",smooth=0)
        for ring in (-.23,.23):
            p=mid+axis*ring
            rod(m,p-axis*.035,p+axis*.035,.259,"weapon_b","weapon",segments=12)
        for k in range(3):
            a=k*2*math.pi/3
            p=mid+Vector((math.sin(a)*.245,-math.cos(a)*.245,0))
            m.part("box",(.027,.015,.25),at=tuple(p),rot=(0,0,k*120),slot="extra_b",bone="weapon",material="glow",light=False)
    finish_animations(m,weight=1.30)
    # Long sweeps turn the complete staff around the actual grip.
    aim_weapon(m,"attack",g,[(1,5),(10,70),(18,100),(25,85),(40,5)])
    aim_weapon(m,"attack2",g,[(1,5),(10,-60),(20,95),(30,45),(40,5)])
    m.action("roll",30,{"hips":[(1,(25,0,0)),(8,(115,0,0)),(15,(205,0,0)),(22,(295,0,0)),(30,(385,0,0))],"upper_arm.R":[(1,(65,0,30)),(30,(65,0,30))],"upper_arm.L":[(1,(65,0,-30)),(30,(65,0,-30))]})
    m.socket("core",(0,-.36,1.16),"hips")
    return m
