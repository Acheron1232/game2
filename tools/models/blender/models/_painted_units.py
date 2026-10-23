"""Painted U02/U06 variants built with the original chunky/unit kit.

The UV contract is explicit: head/body front and back have separate half-cells;
arms and legs have one continuous joint-to-joint coordinate. Paint carries the detail.
"""
import math
import bpy
from mathutils import Euler, Matrix, Vector
import chunky as c
import humanoid
import unitkit as u
from kit import Model
from weapon_pose import aim_weapon


class PaintedModel(Model):
    def __init__(self, name):
        super().__init__(name, skin=name+"_skin")
        self.part_bone="root"
        self.part_inverse=Matrix.Identity(4)
        self.mapping_role=None
        self.bulk=1
        self.robed=False

    def part(self, kind, size, at=(0,0,0), rot=(0,0,0), **kw):
        self.part_bone=kw.get("bone","root")
        self.part_inverse=(Matrix.Translation(Vector(at)) @ Euler(tuple(math.radians(a) for a in rot),"XYZ").to_matrix().to_4x4()).inverted()
        return super().part(kind,size,at=at,rot=rot,**kw)

    def _uv_into_slot(self, mesh, slot, mode="box", back=None, frame=None, sub=None):
        role=slot.split("__")[-1]
        bone=self.part_bone
        rect=self._rect(slot)
        uv=mesh.uv_layers.new(name="UVMap")

        def put(li,s,t,r=rect):
            u0,v0,u1,v1=r
            uv.data[li].uv=(u0+min(1,max(0,s))*(u1-u0),v0+min(1,max(0,t))*(v1-v0))

        # Front/back portraits must never be projected through to the opposite side.
        if role in ("face","body") and sub is None:
            if role=="body":
                z0=self.joints["hips"][2]-.04
                z1=self.joints["neck"][2]+.06
                x0,x1=-.31*self.bulk,.31*self.bulk
            else:
                x0,x1,z0,z1=frame
            for poly in mesh.polygons:
                rear=poly.normal.y>0
                cap=abs(poly.normal.z)>.80
                for li in poly.loop_indices:
                    p=mesh.vertices[mesh.loops[li].vertex_index].co
                    x=(p.x-x0)/max(.001,x1-x0)
                    t=(p.z-z0)/max(.001,z1-z0)
                    s=.5+.5*(1-x) if rear or cap else .5*x
                    # Cap samples stay in the back's plain helmet/hood surface.
                    if cap: s=.75
                    put(li,s,t)
            return

        # The painted sheet has separate front/back limb strips. Project across the
        # actual bone axis and keep one joint-to-joint height: elbow/knee is t=0.5.
        segment=None
        if role=="arm" and "." in bone:
            side=bone.split(".")[-1]
            if bone.startswith("upper_arm"): segment=(self.joints["upper_arm."+side],self.joints["forearm."+side],.5,1)
            if bone.startswith("forearm"): segment=(self.joints["forearm."+side],self.joints["hand."+side],0,.5)
        if role=="legs" and not self.robed and "." in bone:
            side=bone.split(".")[-1]
            if bone.startswith("thigh"): segment=(self.joints["thigh."+side],self.joints["shin."+side],.5,1)
            if bone.startswith("shin"): segment=(self.joints["shin."+side],self.joints["foot."+side],0,.5)
        if segment:
            a,b,t0,t1=segment
            a,b=Vector(a),Vector(b)
            axis=(b-a).normalized()
            length=(b-a).length
            front=Vector((0,-1,0))
            front=(front-axis*front.dot(axis)).normalized()
            right=axis.cross(front).normalized()
            across=[(v.co-a).dot(right) for v in mesh.vertices]
            left_edge,right_edge=min(across),max(across)
            for poly in mesh.polygons:
                coords=[]
                rear=poly.normal.dot(front)<0
                for li in poly.loop_indices:
                    p=mesh.vertices[mesh.loops[li].vertex_index].co-a
                    along=p.dot(axis)
                    across=(p.dot(right)-left_edge)/max(.0001,right_edge-left_edge)
                    s=.5+.5*(1-across) if rear else .5*across
                    t=t1-(t1-t0)*along/length
                    coords.append((li,s,t))
                for li,s,t in coords:
                    put(li,s,t)
            return

        if self.mapping_role=="shield":
            co=[v.co for v in mesh.vertices]
            lo=min(p.x for p in co); hi=max(p.x for p in co)
            bot=min(p.z for p in co); top=max(p.z for p in co)
            for poly in mesh.polygons:
                rear=poly.normal.y<0
                for li in poly.loop_indices:
                    p=co[mesh.loops[li].vertex_index]
                    s=(p.x-lo)/(hi-lo)
                    t=(p.z-bot)/(top-bot)
                    put(li,s*.5,t*.5+(0 if rear else .5))
            return

        # Other props use local-space projections. This also keeps narrow rotated
        # pole shafts inside their wood strip rather than crossing the painted blade.
        mesh.uv_layers.remove(uv)
        original=[v.co.copy() for v in mesh.vertices]
        for v in mesh.vertices: v.co=self.part_inverse @ v.co
        mesh.update()
        super()._uv_into_slot(mesh,slot,mode,back,frame,sub)
        for v,p in zip(mesh.vertices,original): v.co=p
        mesh.update()


def body(m, mage=False):
    m.bulk=.96 if mage else 1.06
    m.robed=mage
    s=u.Slots(m.name)
    b=m.bulk
    humanoid.skeleton(m,height=1.75,shoulders=.25*b,hips=.12*b,leg_len=.95,arm_len=1.05,hunch=.4,arm_spread=.35,knee_bend=.25,elbow_bend=.6)
    c.torso(m,front=s.body,back=s.body,waist=(.36*b,.26*b),belly=(.42*b,.30*b),chest=(.56*b,.36*b),shoulders=(.62*b,.36*b),neck=(.24,.20),hump=False)
    # The painted helmet/hood forms the head surface; no small geometric face floats inside it.
    c.head(m,face=s.face,back=s.face,size=(.30,.27,.31) if mage else (.29,.27,.29),jaw=.82 if mage else 1.0,ears=None)
    for side in ("L","R"):
        c.arm(m,side,skin=s.arm,fore=s.arm,band=None,upper=(.24*b,.21*b,.16*b,.13*b),forearm=(.13*b,.17*b,.15*b,.12*b),bracer=False)
        if not mage:
            c.leg(m,side,thigh_slot=s.legs,shin_slot=s.legs,foot_slot=s.foot_hand,thigh=(.20*b,.21*b,.14*b),shin=(.13*b,.14*b,.10*b),band=None,foot_sub=u.FOOT)
        c.fist(m,side,slot=s.foot_hand,size=.065*b,sub=u.HAND)
    if mage:
        hz=m.joints["hips"][2]
        m.part("loft",1,profile=[(0,.02,.035,.68,.53),(0,.015,.35,.59,.46),(0,0,hz+.02,.39,.30)],slot=s.legs,uv="wrap",bone="hips",segments=10,smooth=35)
        # Boot tips only; the painted robe hides the legs.
        for side,sx in (("L",1),("R",-1)):
            m.part("box",(.12,.23,.09),at=(sx*.12,-.08,.045),slot=s.foot_hand,sub=u.FOOT,uv="top",bone="foot."+side,bevel=.12)
    else:
        for side in ("L","R"):
            c.shoulder_pad(m,side,slot=s.team,size=.66,spikes=0)
    return s


def shaft(m,a,b,width,slot,bone="weapon",sub=None):
    a,b=Vector(a),Vector(b)
    length=(b-a).length
    rot=tuple(math.degrees(v) for v in (b-a).to_track_quat("Z","Y").to_euler())
    return m.part("cylinder",(width,width,length),at=tuple((a+b)*.5),rot=rot,slot=slot,sub=sub,uv="wrap",bone=bone,segments=6,smooth=35)


def replace_action(m,name,length,keys):
    for tr in list(m.armature.animation_data.nla_tracks):
        if tr.name==name: m.armature.animation_data.nla_tracks.remove(tr)
    old=bpy.data.actions.get(name)
    if old: bpy.data.actions.remove(old)
    m.actions=[a for a in m.actions if a[0]!=name]
    m.action(name,length,keys,loop=False)


def build_warden():
    m=PaintedModel("pike_warden")
    s=body(m)
    # Small crest and skirt have their own cloth tile, not a repeat of the torso painting.
    hx,hy,hz=m.joints["head"]
    m.part("loft",1,profile=[(0,hy+.02,hz+.24,.07,.17),(0,hy+.06,hz+.40,.055,.21),(0,hy+.19,hz+.36,.025,.06)],slot=s.team,uv="front",bone="head",segments=4)
    c.loincloth(m,slot=s.team,length=.32,width=.22)
    g=Vector(c.grip_point(m,"R"))
    m.armature["weapon_grip"]=list(g)
    a,b=g+Vector((0,0,-.76)),g+Vector((0,0,1.21))
    shaft(m,a,b,.04,s.weapon_a,sub=(.02,.43,.02,.98))
    # Diamond section: the right half of weapon_a is a whole spear blade.
    bx,by,bz=b
    m.part("hull",1,profile=[(bx,by,bz-.025),(bx-.075,by,bz+.045),(bx+.075,by,bz+.045),(bx,by-.022,bz+.10),(bx,by+.022,bz+.10),(bx,by,bz+.32)],slot=s.weapon_a,uv="front",sub=(.55,.98,.02,.98),bone="weapon",smooth=0)
    # Back shield: front and rear use different painted quadrants.
    m.mapping_role="shield"
    m.part("hull",1,profile=[(-.22,.18,1.40),(.22,.18,1.40),(-.25,.18,1.16),(.25,.18,1.16),(0,.18,.82),(-.22,.24,1.40),(.22,.24,1.40),(0,.28,1.14),(0,.24,.82)],slot=s.weapon_b,bone="chest",uv="front",smooth=15)
    m.mapping_role=None
    # Recolorable pennant, with back faces to survive real-time culling.
    p=m.part("hull",1,profile=[(bx,by,bz-.10),(bx+.20,by,bz-.10),(bx+.14,by,bz-.22),(bx+.19,by,bz-.30),(bx,by,bz-.28),(bx,by+.01,bz-.10)],slot=s.team,uv="front",bone="weapon")
    humanoid.animations(m,weight=1.1)
    for name in ("attack","attack2"):
        replace_action(m,name,40,{
            "chest":[(1,(0,0,0)),(12,(5,0,-8)),(19,(-10,0,8)),(28,(0,0,-3)),(40,(0,0,0))],
            "upper_arm.R":[(1,(0,0,0)),(12,(-12,0,-5)),(19,(68,0,3)),(28,(12,0,-4)),(40,(0,0,0))],
            "forearm.R":[(1,(0,0,0)),(12,(25,0,0)),(19,(-20,0,0)),(28,(20,0,0)),(40,(0,0,0))],
            "upper_arm.L":[(1,(0,0,0)),(12,(22,0,12)),(19,(40,0,12)),(40,(0,0,0))]
        })
        aim_weapon(m,name,g,[(1,0),(10,72),(14,84),(19,84),(25,84),(30,62),(40,0)])
    aim_weapon(m,"walk",g,[(1,8),(8,12),(16,8),(24,12),(31,8)])
    m.socket("weapon",tuple(b),"weapon")
    return m


def build_frost():
    m=PaintedModel("frost_adept")
    s=body(m,mage=True)
    # A compact silhouette like the old caster models. Fur and robe detail is painted.
    c.cape(m,slot=s.team,length=.95,width=.52)
    hx,hy,hz=m.joints["head"]
    m.part("hull",1,profile=[(-.10,hy+.01,hz+.24),(.10,hy+.01,hz+.24),(0,hy+.08,hz+.38),(0,hy+.17,hz+.25)],slot=s.weapon_b,sub=(.52,.98,.02,.48),bone="head",uv="front")
    for i in range(5):
        a=math.pi*2*i/5
        c.blob(m,(math.sin(a)*.24,math.cos(a)*.14,1.43),.09,s.weapon_b,"chest",sub=(.02,.48,.52,.98),squash=(1.3,1,.8))
    g=Vector(c.grip_point(m,"R"))
    m.armature["weapon_grip"]=list(g)
    a,b=g+Vector((0,0,-.73)),g+Vector((0,0,.84))
    shaft(m,a,b,.045,s.weapon_a,sub=(.02,.43,.02,.98))
    bx,by,bz=b
    m.part("loft",1,profile=[(bx,by,bz,.005,.005),(bx,by,bz+.08,.14,.12),(bx,by,bz+.24,.12,.10),(bx,by,bz+.36,.005,.005)],slot=s.weapon_a,sub=(.55,.98,.02,.98),uv="front",bone="weapon",segments=5,smooth=0,material="glow",light=False)
    # One held spell shard, consistent with the old units' simple silhouette.
    hx,hy,hz=m.joints["hand.L"]
    m.part("loft",1,profile=[(hx,hy-.04,hz+.08,.005,.005),(hx,hy-.04,hz+.15,.10,.085),(hx,hy-.04,hz+.29,.005,.005)],slot=s.weapon_b,sub=(.52,.98,.52,.98),uv="front",bone="hand.L",segments=5,smooth=0,material="glow",light=False)
    humanoid.animations(m,style="caster",weight=1.1)
    for name,length in (("attack",34),("attack2",38),("cast",48)):
        wind=round(length*.28); release=round(length*.53); hold=round(length*.66)
        replace_action(m,name,length,{
            "chest":[(1,(0,0,0)),(wind,(5,0,-8)),(release,(-5,0,8)),(length,(0,0,0))],
            "upper_arm.L":[(1,(0,0,0)),(wind,(40,0,18)),(release,(78,0,10)),(hold,(78,0,10)),(length,(0,0,0))],
            "forearm.L":[(1,(0,0,0)),(wind,(30,0,0)),(release,(-12,0,0)),(hold,(-12,0,0)),(length,(0,0,0))],
            "upper_arm.R":[(1,(0,0,0)),(wind,(12,0,-8)),(release,(25,0,-8)),(length,(0,0,0))],
            "forearm.R":[(1,(0,0,0)),(wind,(8,0,0)),(release,(16,0,0)),(length,(0,0,0))]
        })
        aim_weapon(m,name,g,[(1,0),(wind,8),(release,14),(hold,14),(length,0)])
    aim_weapon(m,"walk",g,[(1,3),(8,7),(16,3),(24,7),(31,3)])
    m.socket("staff",tuple(b+Vector((0,0,.2))),"weapon")
    return m
