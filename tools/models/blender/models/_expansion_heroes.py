"""Five painted heroes. Shared anatomy/UV rules, distinct equipment and silhouettes."""
import math
import random
import bpy
from mathutils import Euler, Matrix, Vector
import chunky as c
import humanoid
from kit import Model
from weapon_pose import aim_weapon


class HeroModel(Model):
    def __init__(self,name):
        super().__init__(name,skin=name+"_skin")
        self.mapping_bone="root"
        self.local_inverse=Matrix.Identity(4)

    def part(self,kind,size,at=(0,0,0),rot=(0,0,0),**kw):
        self.mapping_bone=kw.get("bone","root")
        self.local_inverse=(Matrix.Translation(Vector(at)) @ Euler(tuple(math.radians(v) for v in rot),"XYZ").to_matrix().to_4x4()).inverted()
        slot=kw.get("slot","cloth")
        if kind=="loft" and slot in ("face","chest","back","arm","forearm","legs","shin"):
            kw["segments"]=max(12,kw.get("segments",10))
        obj=super().part(kind,size,at=at,rot=rot,**kw)
        obj["paint_slot"]=slot
        obj["shape_kind"]=kind
        return obj

    def _uv_into_slot(self,mesh,slot,mode="box",back=None,frame=None,sub=None):
        bone=self.mapping_bone
        if slot in ("arm","forearm","legs","shin") and "." in bone and sub is None:
            b=self.bones[bone]
            a,end=Vector(b[0]),Vector(b[1]); axis=(end-a).normalized()
            front=Vector((0,-1,0)); front=(front-axis*front.dot(axis)).normalized()
            right=axis.cross(front).normalized()
            across=[(v.co-a).dot(right) for v in mesh.vertices]
            low,high=min(across),max(across)
            uv=mesh.uv_layers.new(name="UVMap")
            u0,v0,u1,v1=self._rect(slot)
            for p in mesh.polygons:
                rear=p.normal.dot(front)<0
                for li in p.loop_indices:
                    pt=mesh.vertices[mesh.loops[li].vertex_index].co-a
                    u=(pt.dot(right)-low)/max(.001,high-low)
                    if rear: u=.02+u*.10
                    v=1-pt.dot(axis)/(end-a).length
                    uv.data[li].uv=(u0+min(1,max(0,u))*(u1-u0),v0+min(1,max(0,v))*(v1-v0))
            return
        original=[v.co.copy() for v in mesh.vertices]
        # Authored body/head frames are in character space; props are in their own frame.
        use_local=frame is None
        if use_local:
            for v in mesh.vertices: v.co=self.local_inverse @ v.co
            mesh.update()
        super()._uv_into_slot(mesh,slot,mode,back,frame,sub)
        if use_local:
            for v,p in zip(mesh.vertices,original): v.co=p
            mesh.update()

    def finish(self):
        # Subdivide selected organic forms, preserving UV interpolation, until the hero
        # reaches its art budget. Extra vertices round real silhouettes rather than props.
        def tris(mesh): return sum(len(p.vertices)-2 for p in mesh.polygons)
        total=sum(tris(o.data) for o,b in self.parts)
        candidates=[o for o,b in self.parts if o.get("shape_kind") in ("sphere","loft") and o.get("paint_slot") in ("face","head_back","chest","back","arm","forearm","hand","legs","shin")]
        for obj in candidates:
            if total>=3900: break
            before=tris(obj.data)
            bpy.context.view_layer.objects.active=obj
            mod=obj.modifiers.new("rounded_silhouette","SUBSURF")
            mod.levels=1; mod.render_levels=1
            bpy.context.view_layer.update()
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            delta=tris(evaluated.to_mesh())-before
            evaluated.to_mesh_clear()
            if total+delta>5000:
                obj.modifiers.remove(mod)
                continue
            bpy.ops.object.modifier_apply(modifier=mod.name)
            total+=delta
        return super().finish()


def orb(m,at,size,slot,bone="chest",segments=16,rings=9,sub=None,glow=False):
    return m.part("sphere",size,at=tuple(at),slot=slot,bone=bone,segments=segments,rings=rings,sub=sub,smooth=60,material="glow" if glow else "palette",light=not glow)


def rod(m,a,b,r,slot="weapon_b",bone="chest",segments=8,sub=None):
    a,b=Vector(a),Vector(b); d=b-a
    rot=tuple(math.degrees(v) for v in d.to_track_quat("Z","Y").to_euler())
    return m.part("cylinder",(2*r,2*r,d.length),at=tuple((a+b)*.5),rot=rot,slot=slot,bone=bone,segments=segments,uv="wrap",sub=sub,smooth=40)


def plate(m,at,size,slot="weapon_b",bone="chest",rot=(0,0,0)):
    return m.part("box",size,at=tuple(at),rot=rot,slot=slot,bone=bone,bevel=.15,smooth=35)


def crystal(m,at,w,h,slot="extra_b",bone="chest",glow=True):
    x,y,z=at
    return m.part("loft",1,profile=[(x,y,z-h*.4,.005,.005),(x,y,z-h*.1,w,w*.8),(x,y,z+h*.25,w*.8,w*.7),(x,y,z+h*.6,.005,.005)],slot=slot,bone=bone,segments=6,uv="front",smooth=0,material="glow" if glow else "palette",light=not glow)


def cape(m,width=.8,length=1.2,slot="cloth",bone="chest"):
    top=m.joints["neck"][2]
    profile=[(0,.18,top-.03,width*.68,.06),(0,.29,top-length*.3,width*.9,.06),(0,.36,top-length*.7,width,.055),(0,.38,top-length,width*1.05,.04)]
    return m.part("loft",1,profile=profile,slot=slot,bone=bone,segments=12,uv="front",smooth=45)


def anatomy(m,bulk=1,height=2.0,robe=False,head_size=(.34,.30,.35),head=True,legs=True):
    humanoid.skeleton(m,height=height,shoulders=.29*bulk,hips=.15*bulk,arm_len=1.05,leg_len=.96,hunch=.3,arm_spread=.5,elbow_bend=.7,knee_bend=.25)
    c.torso(m,front="chest",back="back",waist=(.42*bulk,.31*bulk),belly=(.51*bulk,.39*bulk),chest=(.67*bulk,.44*bulk),shoulders=(.72*bulk,.42*bulk),neck=(.27,.23),hump=False)
    if head: c.head(m,face="face",back="head_back",size=head_size,ears=None)
    for side in ("L","R"):
        sh,el,wr=[m.joints[n+"."+side] for n in ("upper_arm","forearm","hand")]
        c.limb(m,sh,el,[(0,.24*bulk,.23*bulk),(.3,.28*bulk,.24*bulk),(.75,.21*bulk,.20*bulk),(1,.17*bulk,.16*bulk)],slot="arm",bone="upper_arm."+side,uv="front",smooth=50)
        c.limb(m,el,wr,[(0,.17*bulk,.16*bulk),(.3,.23*bulk,.21*bulk),(.8,.19*bulk,.17*bulk),(1,.14*bulk,.13*bulk)],slot="forearm",bone="forearm."+side,uv="front",smooth=50)
        orb(m,sh,(.33*bulk,.32*bulk,.30*bulk),"arm","upper_arm."+side)
        g=Vector(c.grip_point(m,side))
        orb(m,g,(.18*bulk,.19*bulk,.19*bulk),"hand","hand."+side,segments=12,rings=7)
        # Individual knuckles and thumb improve hand silhouettes in close views.
        for i in range(4):
            orb(m,g+Vector(((i-1.5)*.036*bulk,-.07*bulk,0)),(.045*bulk,.065*bulk,.08*bulk),"hand","hand."+side,segments=6,rings=4)
        sx=1 if side=="L" else -1
        orb(m,g+Vector((-sx*.07*bulk,-.015,.045)),(.08*bulk,.09*bulk,.095*bulk),"hand","hand."+side,segments=8,rings=5)
        if legs and not robe:
            c.leg(m,side,thigh_slot="legs",shin_slot="shin",foot_slot="foot",band=None,thigh=(.25*bulk,.27*bulk,.18*bulk),shin=(.18*bulk,.21*bulk,.13*bulk),boot=1.15*bulk)
    if robe:
        hz=m.joints["hips"][2]
        m.part("loft",1,profile=[(0,.02,.12,.78*bulk,.59*bulk),(0,.01,.38,.70*bulk,.52*bulk),(0,0,.69,.57*bulk,.43*bulk),(0,0,hz+.03,.43*bulk,.33*bulk)],slot="legs",bone="hips",segments=16,uv="wrap",smooth=45)
    return m


def finish_animations(m,style="melee",weight=1.1):
    humanoid.animations(m,style=style,weight=weight)
    m.socket("weapon",c.grip_point(m,"R"),"weapon")
    return m


def thorn_marshal():
    m=HeroModel("thorn_marshal"); anatomy(m,bulk=1.08,height=2.05,head_size=(.34,.32,.38))
    hx,hy,hz=m.joints["head"]
    # Long deer muzzle, paired ears, branching antlers.
    orb(m,(0,hy-.15,hz+.065),(.25,.35,.20),"face","head",segments=14,rings=7,sub=(.15,.85,.02,.44))
    for sx in (-1,1):
        orb(m,(sx*.19,hy+.015,hz+.23),(.14,.11,.31),"head_back","head",segments=10,rings=6)
        points=[(sx*.12,hy+.02,hz+.31),(sx*.25,hy+.01,hz+.57),(sx*.35,hy+.04,hz+.83),(sx*.47,hy+.06,hz+.97)]
        for a,b in zip(points,points[1:]): rod(m,a,b,.031,"weapon_b","head",segments=7)
        for i,p in enumerate(points[1:]):
            rod(m,p,(p[0]-sx*(.11+.02*i),p[1]-.025,p[2]+.16),.021,"weapon_b","head",segments=6)
    cape(m,.91,1.26)
    # Overlapping pointed leaf mantle; each leaf samples only a painted leaf surface.
    for i in range(24):
        a=math.pi*2*i/24
        x,y=math.sin(a)*.40,math.cos(a)*.25
        z=m.joints["neck"][2]-.03
        m.part("loft",1,profile=[(x*.82,y*.82,z+.05,.09,.025),(x,y,z-.11,.17,.04),(x*1.16,y*1.16,z-.34,.008,.008)],slot="extra_a",bone="chest",segments=4,uv="front",smooth=25)
    for side in ("L","R"):
        c.shoulder_pad(m,side,slot="team",size=.85,spikes=0)
    c.belt(m,slot="back",size=(.50,.37),height=.1)
    c.loincloth(m,slot="team",length=.48,width=.30)
    g=Vector(c.grip_point(m,"R")); m.armature["weapon_grip"]=list(g)
    rod(m,g+Vector((0,0,-.65)),g+Vector((0,0,1.23)),.033,"weapon_a","weapon",segments=10)
    tip=g+Vector((0,0,1.24))
    m.part("hull",1,profile=[tuple(tip+Vector(p)) for p in [(-.12,0,.07),(.12,0,.07),(0,-.04,.13),(0,.04,.13),(0,0,.42),(0,0,-.03)]],slot="extra_b",bone="weapon",uv="front",smooth=0)
    finish_animations(m,weight=1.13)
    # Use the approved spear thrust, with a world-space weapon direction.
    for name in ("attack","attack2"):
        for tr in list(m.armature.animation_data.nla_tracks):
            if tr.name==name:m.armature.animation_data.nla_tracks.remove(tr)
        old=bpy.data.actions.get(name)
        if old:bpy.data.actions.remove(old)
        m.actions=[a for a in m.actions if a[0]!=name]
        m.action(name,40,{"chest":[(1,(0,0,0)),(12,(4,0,-10)),(20,(-9,0,10)),(40,(0,0,0))],"upper_arm.R":[(1,(0,0,0)),(12,(-8,0,-3)),(20,(65,0,3)),(40,(0,0,0))],"forearm.R":[(1,(0,0,0)),(12,(24,0,0)),(20,(-17,0,0)),(40,(0,0,0))]},loop=False)
        aim_weapon(m,name,g,[(1,0),(12,74),(18,84),(23,84),(30,64),(40,0)])
    aim_weapon(m,"walk",g,[(1,8),(8,12),(16,8),(24,12),(32,8)])
    return m


def grave_bellkeeper():
    m=HeroModel("grave_bellkeeper"); anatomy(m,bulk=1.08,height=2.08,robe=True,head_size=(.37,.33,.39))
    cape(m,.96,1.30)
    # Three small reliquary towers create the distinctive backpack silhouette.
    for i,x in enumerate((-.29,0,.29)):
        z=1.58+(0.17 if i==1 else 0)
        plate(m,(x,.39,z),(.28,.31,.71),"extra_a")
        m.part("cone",(.43,.44,.27),at=(x,.39,z+.48),slot="weapon_b",segments=4,rot=(0,0,45),smooth=0)
        crystal(m,(x,.21,z+.12),.10,.20)
        for sx in (-1,1): rod(m,(x+sx*.11,.21,z-.2),(x+sx*.11,.21,z+.28),.018,"weapon_b")
    g=Vector(c.grip_point(m,"R"))
    rod(m,g+Vector((0,0,-.07)),g+Vector((0,0,.23)),.045,"weapon_b","weapon",segments=10)
    x,y,z=g+Vector((0,0,-.31))
    m.part("lathe",1,at=(x,y,z),profile=[(.27,-.18),(.28,-.14),(.24,-.07),(.20,.04),(.12,.18),(.07,.23)],slot="weapon_a",bone="weapon",segments=20,uv="wrap",smooth=50)
    m.part("cylinder",(.47,.47,.012),at=(x,y,z-.184),slot="head_back",bone="weapon",segments=20,uv="top")
    orb(m,(x,y,z-.22),(.10,.10,.12),"weapon_b","weapon",segments=10,rings=6)
    # Chain links and spirit gems have separate UV regions, no face projection.
    for i in range(5):
        m.part("torus",(.09,.09,.09),at=(.34,.2,1.62-i*.09),rot=(90 if i%2 else 0,0,0),slot="weapon_b",bone="chest",segments=8,rings=4,profile=.25)
    crystal(m,(0,-.235,1.60),.16,.22)
    finish_animations(m,style="caster",weight=1.20)
    m.socket("core",(0,-.24,1.6),"chest")
    return m


def tidebreaker():
    m=HeroModel("tidebreaker"); anatomy(m,bulk=1.55,height=2.02,head_size=(.48,.40,.42))
    hx,hy,hz=m.joints["head"]
    orb(m,(0,hy-.18,hz+.04),(.45,.33,.25),"face","head",segments=16,rings=9,sub=(.12,.88,.02,.46))
    for sx in (-1,1):
        m.part("loft",1,profile=[(sx*.14,hy-.30,hz+.09,.085,.075),(sx*.15,hy-.32,hz-.09,.070,.060),(sx*.11,hy-.30,hz-.30,.018,.015)],slot="extra_b",bone="head",segments=10,uv="wrap",smooth=60)
        c.shoulder_pad(m,"L" if sx==1 else "R",slot="team",size=1.2,spikes=0)
    c.belt(m,slot="back",size=(.73,.53),height=.14)
    c.loincloth(m,slot="team",length=.47,width=.42)
    cape(m,1.0,.96)
    # Coral growths on the shoulders; the body remains a stout walrus, not a knight.
    for sx,side in ((1,"L"),(-1,"R")):
        x,y,z=m.joints["upper_arm."+side]
        for i in range(3):
            p=(x+sx*(.04+i*.06),y+.04,z+.10)
            rod(m,p,(p[0]+sx*.04,p[1],p[2]+.14+i*.035),.025,"extra_a","upper_arm."+side,segments=6)
    g=Vector(c.grip_point(m,"R"))
    ax=Vector((0,-.16,1)).normalized()
    rod(m,g-ax*.52,g+ax*.53,.055,"weapon_a","weapon",segments=12)
    end=g-ax*.48
    for sx in (-1,1):
        points=[tuple(end+Vector(p)) for p in [(0,-.03,.02),(sx*.35,-.03,.12),(sx*.41,-.03,.37),(sx*.30,-.03,.28),(sx*.24,.06,.09),(0,.06,-.05)]]
        m.part("hull",1,profile=points,slot="weapon_b",bone="weapon",uv="front",smooth=25)
    rod(m,g+ax*.34+Vector((-.22,0,0)),g+ax*.34+Vector((.22,0,0)),.045,"weapon_b","weapon",segments=10)
    m.part("torus",(.23,.23,.23),at=tuple(g+ax*.65),rot=(90,0,0),slot="weapon_b",bone="weapon",segments=14,rings=6,profile=.23)
    finish_animations(m,weight=1.35)
    return m


def lantern_monk():
    m=HeroModel("lantern_monk"); anatomy(m,bulk=1.23,height=1.86,robe=False,head_size=(.43,.34,.38))
    hx,hy,hz=m.joints["head"]
    for sx in (-1,1): orb(m,(sx*.18,hy+.02,hz+.30),(.16,.12,.17),"head_back","head",segments=12,rings=7)
    orb(m,(0,hy-.16,hz+.08),(.26,.21,.17),"face","head",segments=14,rings=7,sub=(.15,.85,.02,.42))
    c.belt(m,slot="back",size=(.57,.44),height=.10)
    c.loincloth(m,slot="team",length=.42,width=.31)
    # Wide straw hat and a full, striped red-panda tail.
    m.part("lathe",1,at=(0,hy,hz+.32),profile=[(.30,0),(.38,.02),(.31,.08),(.13,.17),(.07,.19)],slot="extra_a",bone="head",segments=18,uv="top",smooth=30)
    for i in range(4):
        orb(m,(.05,.29+i*.13,.90-i*.09),(.29,.31,.24),"head_back","hips",segments=12,rings=7,sub=(0,1,i%2*.45,min(1,i%2*.45+.5)))
    c.beads(m,count=11,slot="weapon_b",width=.59,drop=.33,r=.042,sub=(.05,.95,.05,.95),tint="#ffffff")
    g=Vector(c.grip_point(m,"R"))
    rod(m,g+Vector((0,0,-.71)),g+Vector((0,0,1.02)),.031,"weapon_a","weapon",segments=10)
    top=g+Vector((0,0,.90))
    rod(m,top,top+Vector((.36,0,-.04)),.025,"weapon_a","weapon",segments=8)
    p=top+Vector((.34,0,-.30))
    orb(m,p,(.43,.37,.53),"extra_b","weapon",segments=18,rings=12,glow=True)
    for i in range(8):
        a=2*math.pi*i/8
        x,y=p.x+math.sin(a)*.20,p.y+math.cos(a)*.17
        rod(m,(x,y,p.z-.18),(x,y,p.z+.18),.008,"weapon_b","weapon",segments=5)
    rod(m,p+Vector((0,0,-.36)),p+Vector((0,0,-.24)),.025,"team","weapon",segments=8)
    finish_animations(m,weight=1.04)
    m.socket("lantern",tuple(p),"weapon")
    return m


def obsidian_heart():
    m=HeroModel("obsidian_heart")
    humanoid.skeleton(m,height=2.25,shoulders=.43,hips=.20,leg_len=.85,arm_len=1.15,hunch=.2,arm_spread=.8,elbow_bend=.5)
    # Detached volcanic plates orbit one core. No legs are hidden inside a robe.
    m.part("loft",1,profile=[(0,0,.95,.43,.35),(0,0,1.2,.70,.48),(0,0,1.6,.90,.58),(0,.03,1.92,.87,.51),(0,.03,2.02,.35,.30)],slot="chest",back="back",uv="front",frame=(-.48,.48,.95,2.02),bone="chest",segments=12,smooth=40)
    orb(m,(0,-.31,1.58),(.33,.13,.39),"extra_b","chest",segments=16,rings=9,glow=True)
    m.part("loft",1,profile=[(0,-.17,2.0,.28,.24),(0,-.17,2.12,.38,.33),(0,-.14,2.30,.30,.29),(0,-.11,2.37,.12,.10)],slot="face",back="head_back",uv="front",frame=(-.20,.20,2.0,2.37),bone="head",segments=10,smooth=35)
    rnd=random.Random(12)
    for i in range(10):
        a=math.pi*2*i/10
        r=.40 if i%2 else .51
        at=(math.sin(a)*r,.10+math.cos(a)*r*.55,1.55+(.40 if i%2 else -.37))
        m.part("loft",1,profile=[(*at,.23,.18),(at[0]*1.2,at[1]*1.2,at[2]+.21,.20,.15),(at[0]*1.24,at[1]*1.24,at[2]+.37,.015,.015)],slot="head_back",bone="chest",segments=5,smooth=0)
    for side,sx in (("L",1),("R",-1)):
        sh=Vector(m.joints["upper_arm."+side]); el=Vector(m.joints["forearm."+side]); wr=Vector(m.joints["hand."+side])
        orb(m,sh,(.38,.35,.40),"arm","upper_arm."+side,segments=12,rings=7)
        orb(m,el,(.26,.28,.34),"forearm","forearm."+side,segments=12,rings=7)
        orb(m,wr+Vector((sx*.04,0,-.12)),(.49,.43,.49),"hand","hand."+side,segments=16,rings=9)
        for k in range(4): orb(m,wr+Vector((sx*.04+(k-1.5)*.095,-.18,-.08)),(.11,.10,.19),"hand","hand."+side,segments=8,rings=5)
        crystal(m,tuple(sh+Vector((sx*.09,0,.26))),.14,.31,"team","upper_arm."+side,glow=False)
    # Suspended waist fragments define the bottom silhouette without ground contact.
    for sx in (-1,0,1): crystal(m,(sx*.23,0,.74),.23,.32,"head_back","hips",glow=False)
    finish_animations(m,style="caster",weight=1.22)
    # Float rather than walking with invisible legs.
    for name in ("idle","walk"):
        for tr in list(m.armature.animation_data.nla_tracks):
            if tr.name==name:m.armature.animation_data.nla_tracks.remove(tr)
        old=bpy.data.actions.get(name)
        if old:bpy.data.actions.remove(old)
        m.actions=[a for a in m.actions if a[0]!=name]
        m.action(name,60,{"hips":[(1,(0,0,-2),(0,0,0)),(30,(0,0,2),(0,0,.075)),(60,(0,0,-2),(0,0,0))],"upper_arm.L":[(1,(0,0,8)),(30,(5,0,12)),(60,(0,0,8))],"upper_arm.R":[(1,(0,0,-8)),(30,(-5,0,-12)),(60,(0,0,-8))]})
    m.socket("core",(0,-.38,1.58),"chest")
    return m
