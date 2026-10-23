"""Selected expansion batch 2: beasts, siege engines, mercenaries and a glider."""
import math
from mathutils import Vector
import chunky as c
import humanoid
import unitkit as u
import centaur_raider as cr
import _buildings as b
from _painted_units import PaintedModel, body, shaft, replace_action
from _selected_expansion import Structure, box, ring
from weapon_pose import aim_weapon


def blob(m,at,size,slot,bone="root",sub=None):
    return m.part("sphere",size,at=tuple(at),slot=slot,bone=bone,sub=sub,segments=10,rings=6)


class ReinforcementModel(PaintedModel):
    def _uv_into_slot(self,mesh,slot,mode="box",back=None,frame=None,sub=None):
        role=slot.split("__")[-1]
        # Machinery cells are local material panels, not torso/head portraits.
        if self.name in ("covered_ram","bolt_cart"):
            original=self.mapping_role
            self.mapping_role=None
            from kit import Model
            co=[v.co.copy() for v in mesh.vertices]
            for v in mesh.vertices:v.co=self.part_inverse @ v.co
            mesh.update()
            Model._uv_into_slot(self,mesh,slot,mode,back,frame,sub)
            for v,p in zip(mesh.vertices,co):v.co=p
            mesh.update();self.mapping_role=original
            return
        if role=="weapon_b" and sub is None: sub=(.02,.98,.52,.98)
        return super()._uv_into_slot(mesh,slot,mode,back,frame,sub)


def rider_rig(m):
    z=1.02
    bones={
        "root":((0,0,0),(0,0,.2),None),
        "horse":((0,.5,.8),(0,-.2,.9),"root"),
        "withers":((0,-.2,.9),(0,0,1.08),"horse"),
        "hips":((0,.04,1.12),(0,.02,1.27),"withers"),
        "spine":((0,.02,1.27),(0,-.01,1.44),"hips"),
        "chest":((0,-.01,1.44),(0,-.04,1.64),"spine"),
        "neck":((0,-.04,1.64),(0,-.05,1.72),"chest"),
        "head":((0,-.05,1.72),(0,-.06,1.96),"neck"),
        "horse_neck":((0,-.45,.95),(0,-.70,.99),"horse"),
        "horse_head":((0,-.70,.99),(0,-1.15,.78),"horse_neck"),
        "tail":((0,.80,.90),(0,1.1,.75),"horse"),
    }
    for sd,sx in (("L",1),("R",-1)):
        bones["upper_arm."+sd]=((sx*.26,-.04,1.60),(sx*.35,-.08,1.34),"chest")
        bones["forearm."+sd]=((sx*.35,-.08,1.34),(sx*.39,-.32,1.25),"upper_arm."+sd)
        bones["hand."+sd]=((sx*.39,-.32,1.25),(sx*.41,-.42,1.23),"forearm."+sd)
        for kind,y in (("front",-.43),("back",.55)):
            bones[kind+"_upper."+sd]=((sx*.28,y,.82),(sx*.30,y+.08,.40),"withers" if kind=="front" else "horse")
            bones[kind+"_lower."+sd]=((sx*.30,y+.08,.40),(sx*.30,y-.03,.09),kind+"_upper."+sd)
    g=bones["hand.R"][0]
    bones["weapon"]=(g,(g[0],g[1]-.2,g[2]),"hand.R")
    m.skeleton(bones);m.joints={n:v[0] for n,v in bones.items()};m.tails={n:v[1] for n,v in bones.items()};m.height=2.05


def cavalry(name):
    m=ReinforcementModel(name);s=u.Slots(name);rider_rig(m)
    slot=lambda n:name+"__"+n
    ram=name=="ram_drummer"
    # Deep, broad torso and low head distinguish both mounts from the old horse.
    c.limb(m,(0,.85,.84),(0,-.52,.87),[(0,.52,.59),(.35,.92,.83),(.75,.90,.85),(1,.69,.70)],slot=slot("beast_side"),bone="horse",segments=10,uv="wrap")
    if ram:
        # A scalloped wool silhouette, with coarse painted wool on the main body.
        for sx in (-1,1):
            for y in (-.35,.05,.45):blob(m,(sx*.32,y,1.04),(.28,.40,.34),slot("beast_side"),"horse")
    c.limb(m,(0,-.44,.98),(0,-.77,.97),[(0,.60,.61),(1,.42,.45)],slot=slot("beast_side"),bone="horse_neck",segments=8)
    box(m,(0,-.88,.91),(.50,.54,.47),slot("beast_back"),"horse_head",bevel=.22)
    box(m,(0,-1.17,.86),(.40,.10,.31),slot("beast_front"),"horse_head",bevel=.16)
    if not ram:
        # Broad snout, upright ears and two swept tusks.
        for sx in (-1,1):
            m.part("cone",(.18,.16,.29),at=(sx*.23,-.73,1.25),rot=(0,sx*28,0),slot=slot("beast_side"),bone="horse_head",segments=5)
            points=[(sx*.20,-1.14,.75),(sx*.32,-1.22,.82),(sx*.35,-1.20,1.02)]
            for i in range(2):shaft(m,points[i],points[i+1],.075-i*.025,slot("hoof_horn"),"horse_head",sub=(.52,.98,.02,.98))
        # Thick bristle ridge rather than horse mane geometry.
        for i in range(6):m.part("cone",(.11,.17,.20),at=(0,-.38+i*.18,1.29),slot=slot("beast_back"),bone="horse",segments=4)
    else:
        for sx in (-1,1):
            pts=[]
            for i in range(8):
                a=math.radians(-75+i*42)
                pts.append((sx*(.32+.07*i/8),-.72+math.cos(a)*(.25-i*.014),1.14+math.sin(a)*(.25-i*.014)))
            for i in range(7):shaft(m,pts[i],pts[i+1],.14-i*.014,slot("hoof_horn"),"horse_head",sub=(.52,.98,.02,.98))
    for sd in ("L","R"):
        for kind in ("front","back"):
            a=kind+"_upper."+sd;d=kind+"_lower."+sd
            c.limb(m,m.joints[a],m.tails[a],[(0,.25,.28),(1,.16,.17)],slot=slot("beast_legs"),bone=a,segments=6)
            c.limb(m,m.joints[d],m.tails[d],[(0,.16,.17),(1,.13,.14)],slot=slot("beast_legs"),bone=d,segments=6)
            x,y,z=m.tails[d]
            m.part("box",(.20,.27,.18),at=(x,y-.035,.09),slot=slot("hoof_horn"),sub=(.02,.48,.02,.98),bone=d)
    for sx in (-1,1):
        box(m,(sx*.43,.16,.97),(.045,.70,.47),s.team,"horse",bevel=0)
    box(m,(0,.08,1.18),(.64,.66,.12),slot("saddle"),"horse",bevel=.2)
    c.torso(m,front=s.body,back=s.body,waist=(.32,.27),belly=(.40,.30),chest=(.52,.34),shoulders=(.58,.35),neck=(.23,.20),hump=False)
    c.head(m,face=s.face,back=s.face,size=(.28,.25,.27),ears=None)
    for sd,sx in (("L",1),("R",-1)):
        c.arm(m,sd,skin=s.arm,fore=s.arm,band=None,upper=(.21,.19,.14,.12),forearm=(.12,.15,.13,.11),bracer=False)
        c.fist(m,sd,slot=s.foot_hand,size=.062,sub=u.HAND)
        c.limb(m,(sx*.14,.07,1.14),(sx*.45,-.10,.75),[(0,.18,.19),(1,.12,.13)],slot=s.legs,bone="hips",segments=6)
        m.part("box",(.15,.26,.17),at=(sx*.45,-.17,.75),slot=s.foot_hand,sub=u.FOOT,bone="hips")
    g=Vector(c.grip_point(m,"R"));m.armature["weapon_grip"]=list(g)
    if ram:
        # Side drum, frame and two mallets follow the hands.
        m.part("cylinder",(.58,.58,.32),at=(.10,-.60,1.25),rot=(90,0,0),slot=slot("drum"),bone="horse",segments=12)
        for sd in ("L","R"):
            p=Vector(c.grip_point(m,sd));bone="weapon" if sd=="R" else "hand.L"
            end=p+Vector((-p.x*.5,-.27,.07))
            shaft(m,p,end,.045,s.weapon_a,bone,sub=(.18,.32,.05,.48))
            blob(m,end,(.12,.12,.12),slot("drum"),bone)
        hx,hy,hz=m.joints["head"]
        for sx in (-1,1):blob(m,(sx*.15,hy+.01,hz+.15),(.13,.08,.16),slot("hide"),"head")
        shaft(m,(-.24,.24,1.03),(-.24,.24,2.15),.04,slot("saddle"),"horse")
        box(m,(-.02,.24,1.92),(.42,.04,.43),s.team,"horse",bevel=0)
    else:
        axis=Vector((0,-.97,.24));tip=g+axis*1.60
        shaft(m,g-axis*.4,tip,.055,s.weapon_a,sub=(.02,.48,.02,.98))
        shaft(m,tip,tip+axis*.24,.095,s.weapon_a,sub=(.52,.98,.02,.98))
        box(m,tuple(g+axis*1.1+Vector((.10,.13,-.06))),(.24,.04,.28),s.team,"weapon",bevel=0)
    if ram:
        clips={}; real_action=m.action
        m.action=lambda name,length,keys,loop=True:clips.update({name:(length,keys,loop)})
        cr.animations(m)
        m.action=real_action
        for clip,(length,keys,loop) in clips.items():
            if clip in ("idle","walk"):
                keys["upper_arm.R"]=[(1,(-18,0,0)),(length//4,(25,0,0)),(length//2,(-18,0,0)),(length*3//4,(25,0,0)),(length,(-18,0,0))]
                keys["upper_arm.L"]=[(1,(25,0,0)),(length//4,(-18,0,0)),(length//2,(25,0,0)),(length*3//4,(-18,0,0)),(length,(25,0,0))]
            m.action(clip,length,keys,loop)
    else: cr.animations(m)
    if ram:
        for clip in ("attack","attack2","cast"):
            replace_action(m,clip,30,{"upper_arm.R":[(1,(0,0,0)),(8,(-42,0,-15)),(14,(40,0,15)),(30,(0,0,0))],"upper_arm.L":[(1,(0,0,0)),(14,(-35,0,20)),(22,(35,0,-10)),(30,(0,0,0))]})
    else:
        for clip in ("attack","attack2","cast"):
            replace_action(m,clip,30,{"chest":[(1,(0,0,0)),(8,(-8,0,-8)),(15,(13,0,5)),(30,(0,0,0))],"upper_arm.R":[(1,(0,0,0)),(8,(-20,0,0)),(15,(38,0,0)),(30,(0,0,0))]})
            aim_weapon(m,clip,g,[(1,0),(8,-5),(15,10),(22,8),(30,0)])
    return m


def engine(name):
    m=ReinforcementModel(name);s=u.Slots(name)
    # Bone-local Y points forward (-world Y), so the keyed recoil is a real horizontal slide.
    bones={"root":((0,0,0),(0,-.3,0),None),"mechanism":((0,0,.8),(0,-.4,.8),"root")}
    for i,(x,y) in enumerate([(-.68,-.52),(.68,-.52),(-.68,.62),(.68,.62)]):bones["wheel"+str(i)]=((x,y,.31),(x,y,.53),"root")
    m.skeleton(bones);m.joints={n:v[0] for n,v in bones.items()};m.height=1.8
    for i,(x,y) in enumerate([(-.68,-.52),(.68,-.52),(-.68,.62),(.68,.62)]):
        m.part("cylinder",(.61,.61,.17),at=(x,y,.31),rot=(0,90,0),slot=s.foot_hand,bone="wheel"+str(i),segments=12)
    box(m,(0,.02,.58),(1.27,1.70,.19),s.legs)
    for x in (-.44,.44):box(m,(x,.02,.76),(.16,1.9,.20),s.arm)
    if name=="covered_ram":
        for x in (-.51,.51):
            for y in (-.62,.60):box(m,(x,y,1.12),(.15,.16,.82),s.legs)
            box(m,(x,.02,1.06),(.055,1.48,.67),s.weapon_b,bevel=0)
        # Arched layered shelter: roof panels stay outside the working log.
        for sx in (-1,1):
            box(m,(sx*.31,.04,1.60),(.77,1.98,.15),s.body,rot=(0,sx*24,0))
            for y in (-.68,.05,.74):box(m,(sx*.32,y,1.69),(.78,.10,.07),s.arm,rot=(0,sx*24,0))
        shaft(m,(0,.88,.96),(0,-1.15,.96),.24,s.legs,"mechanism")
        box(m,(0,-1.23,.96),(.42,.35,.40),s.face,"mechanism",bevel=.19)
        for x in (-.28,.28):shaft(m,(x,-.42,1.53),(x,-.42,.96),.025,s.weapon_a)
    else:
        # Genuine bow limbs and a taut string, separate from the sliding bolt.
        box(m,(0,.1,1.00),(.27,1.8,.18),s.body)
        for sx in (-1,1):
            pts=[(0,-.48,1.05),(sx*.63,-.42,1.12),(sx*1.10,-.10,1.16)]
            for i in range(2):shaft(m,pts[i],pts[i+1],.14-i*.04,s.legs)
            shaft(m,pts[-1],(0,.42,1.07),.025,s.weapon_a)
        shaft(m,(0,.65,1.16),(0,-1.15,1.16),.045,s.arm,"mechanism")
        m.part("cone",(.12,.12,.32),at=(0,-1.31,1.16),rot=(90,0,0),slot=s.face,bone="mechanism",segments=4)
        m.part("cylinder",(.34,.34,.19),at=(0,.66,.94),rot=(90,0,0),slot=s.weapon_b,bone="root",segments=10)
    shaft(m,(.52,.43,.75),(.52,.43,1.85),.035,s.weapon_a)
    box(m,(.71,.43,1.63),(.37,.035,.33),s.team,bevel=0)
    m.action("idle",60,{"root":[(1,(0,0,0)),(60,(0,0,0))]})
    wheels={"wheel"+str(i):[(1,(0,0,0)),(8,(90,0,0)),(15,(180,0,0)),(22,(270,0,0)),(29,(360,0,0))] for i in range(4)}
    m.action("walk",29,wheels)
    for clip in ("attack","attack2","cast"):
        m.action(clip,36,{"mechanism":[(1,(0,0,0),(0,0,0)),(12,(0,0,0),(0,-.18,0)),(16,(0,0,0),(0,.42 if name=="covered_ram" else .70,0)),(23,(0,0,0),(0,-.12,0)),(36,(0,0,0),(0,0,0))]},loop=False)
    for clip,n,angle in (("hit",12,8),("death",40,75),("victory",30,0)):
        m.action(clip,n,{"root":[(1,(0,0,0)),(n,(0,angle,0))]},loop=False)
    m.socket("weapon",(0,-1.3,1.1),"mechanism")
    return m


def mercenary(name):
    m=ReinforcementModel(name);s=body(m)
    g=Vector(c.grip_point(m,"R"));m.armature["weapon_grip"]=list(g)
    hx,hy,hz=m.joints["head"]
    if name in ("badger_mercenary","fox_trailshot"):
        fox=name=="fox_trailshot"
        for sx in (-1,1):
            m.part("cone",(.14,.11,.26 if fox else .13),at=(sx*.14,hy+.015,hz+.20),slot=s.weapon_b,sub=(.52,.98,.02,.48),bone="head",segments=5)
        blob(m,(0,hy-.16,hz-.03),(.18,.14,.12),s.face,"head",sub=(.15,.35,.22,.47))
        shaft(m,(0,.14,.8),(0,.46,.5),.13 if fox else .09,s.weapon_b,"hips",sub=(.52,.98,.02,.48))
        box(m,(0,.24,1.22),(.39,.27,.43),s.weapon_b,"chest")
        c.cape(m,slot=s.team,length=.7,width=.49)
        if not fox:
            shaft(m,g,g+Vector((0,0,.54)),.075,s.weapon_a)
            box(m,tuple(g+Vector((0,0,.09))),(.25,.06,.05),s.weapon_a,"weapon")
            p=Vector(m.joints["forearm.L"])+Vector((.06,-.19,-.1))
            m.part("cylinder",(.61,.61,.10),at=tuple(p),rot=(90,0,0),slot=s.team,bone="forearm.L",segments=12)
            ring(m,tuple(p+Vector((0,-.06,0))),(.62,.62,.04),s.weapon_a,"forearm.L")
            blob(m,p+Vector((0,-.08,0)),(.15,.07,.15),s.weapon_a,"forearm.L")
        else:
            # A small physical crossbow with two limbs and a string.
            shaft(m,g+Vector((0,.17,0)),g+Vector((0,-.51,0)),.07,s.weapon_b,sub=(.02,.48,.52,.98))
            for sx in (-1,1):
                tip=g+Vector((sx*.31,-.30,.03))
                shaft(m,g+Vector((0,-.42,0)),tip,.055,s.weapon_a)
                shaft(m,tip,g+Vector((0,-.09,.02)),.012,s.weapon_a)
            box(m,(0,hy,hz+.20),(.52,.42,.055),s.weapon_b,"head",bevel=.2)
    else:
        # A broad basalt face, hammer, large open coal basket and visible coal lumps.
        box(m,(0,.30,1.25),(.63,.39,.70),s.weapon_b,"chest")
        for i in range(5):blob(m,(-.20+(i%3)*.20,.33,1.60+(i%2)*.08),(.23,.22,.22),s.legs,"chest")
        for x in (-.29,0,.29):box(m,(x,.52,1.23),(.06,.05,.68),s.weapon_a,"chest")
        shaft(m,g,g+Vector((0,0,.54)),.06,s.weapon_a)
        box(m,tuple(g+Vector((0,0,.54))),(.40,.21,.21),s.weapon_b,"weapon")
    humanoid.animations(m,weight=1.2 if name!="fox_trailshot" else .85)
    for clip in ("attack","attack2","cast"):
        if name=="fox_trailshot":
            replace_action(m,clip,32,{"chest":[(1,(0,0,0)),(10,(0,0,-8)),(16,(5,0,0)),(32,(0,0,0))],"weapon":[(1,(0,0,0)),(16,(-10,0,0)),(24,(0,0,0)),(32,(0,0,0))]})
        else:
            replace_action(m,clip,34,{"upper_arm.R":[(1,(0,0,0)),(10,(-55,0,0)),(18,(48,0,0)),(34,(0,0,0))]})
            aim_weapon(m,clip,g,[(1,0),(10,-40),(18,65),(34,0)])
    return m


def kite_bomber():
    m=ReinforcementModel("kite_bomber");s=body(m)
    # A suspended pilot and a stiff fabric airframe, not flapping bird wings.
    box(m,(0,.08,1.12),(.45,1.45,.21),s.weapon_b,"root")
    for sx in (-1,1):
        pts=[(sx*.18,-.50,1.48),(sx*1.65,.12,1.42),(sx*1.15,.63,1.35),(sx*.58,.43,1.32),(sx*.15,.66,1.37)]
        m.part("hull",1,profile=pts+[(x,y,z-.045) for x,y,z in pts],slot=s.weapon_a,bone="root",uv="top")
        for p in (pts[1],pts[2]):shaft(m,pts[0],p,.055,s.weapon_b,"root",sub=(.02,.48,.52,.98))
        box(m,(sx*.98,.15,1.48),(.31,.52,.025),s.team,"root",rot=(0,0,sx*20),bevel=0)
    # Clay bombs share a moving release rack; the attack clip drops the rack and reloads.
    for sx in (-1,1):
        blob(m,(sx*.32,.08,.57),(.29,.29,.34),s.weapon_b,"weapon",sub=(.52,.98,.02,.48))
        shaft(m,(sx*.32,.08,.73),(sx*.32,.08,.87),.035,s.weapon_b,"weapon",sub=(.02,.48,.52,.98))
    humanoid.animations(m)
    for clip,length in (("idle",60),("walk",32)):
        replace_action(m,clip,length,{"root":[(1,(0,0,-2),(0,0,.03)),(length//2,(0,0,2),(0,0,-.03)),(length,(0,0,-2),(0,0,.03))]})
    for clip in ("attack","attack2","cast"):
        replace_action(m,clip,40,{"root":[(1,(0,0,0)),(15,(12,0,-7)),(29,(-5,0,4)),(40,(0,0,0))],"weapon":[(1,(0,0,0),(0,0,0)),(15,(0,0,0),(0,0,-.10)),(21,(0,0,0),(0,0,-1.0)),(28,(0,0,0),(0,0,-1.0)),(40,(0,0,0),(0,0,0))]})
    m.socket("bomb",(0,0,.5),"weapon")
    return m


def structure(name):
    m=Structure(name);m.skeleton({"root":((0,0,0),(0,0,.5),None)})
    m.joints={"root":(0,0,0)};m.height=3.8
    def q(at,size,slot="wood",**kw):return box(m,at,size,slot,**kw)
    q((0,0,.12),(3.9,3.6,.24),"foundation")
    if name=="tusk_lodge":
        q((-.45,.25,1.1),(2.6,2.55,1.9),"wood")
        b.gable_roof(m,2.85,2.8,.95,2.0,"roof",at=(-.45,.25))
        q((-.45,-1.08,.91),(.88,.12,1.5),"door")
        # Low boar head above the entrance and two giant tusks frame the sign.
        blob(m,(-.45,-1.26,2.12),(.74,.35,.46),"iron")
        q((-.45,-1.48,2.08),(.43,.13,.23),"brass")
        for sx in (-1,1):
            shaft(m,(-.45+sx*.25,-1.39,1.97),(-.45+sx*.45,-1.40,2.39),.11,"brass","root")
        for y in (-1.1,-.45,.25,1.0):q((1.5,y,.65),(.13,.13,1.0))
        for z in (.45,.85):q((1.5,-.03,z),(.11,2.4,.12))
        q((.80,1.10,.80),(1.4,.10,.12))
        q((1.03,.22,.70),(.65,1.02,.62),"statue_body")
        blob(m,(1.03,-.35,.70),(.44,.42,.38),"iron")
        q((-.45,-1.20,1.58),(.50,.035,.42),"banner",bevel=0)
    else:
        cinder=name=="cinder_inn"
        q((-.15,.18,1.10),(3.15,2.65,1.98),"stone" if cinder else "wall")
        b.gable_roof(m,3.4,2.95,1.03,2.07,"iron" if cinder else "roof",at=(-.15,.18))
        q((-.15,-1.18,.90),(.78,.13,1.47),"door")
        for x in (-1.12,.83):
            q((x,-1.19,1.14),(.52,.045,.64),"furnace" if cinder else "banner",bevel=0)
            for dx in (-.30,.30):q((x+dx,-1.23,1.15),(.08,.09,.78),"wood")
        q((.92,.85,2.85),(.58,.62,1.55),"stone")
        q((.92,.85,3.65),(.75,.78,.13),"brass")
        shaft(m,(-1.50,-1.25,2.15),(-1.50,-1.95,2.15),.06,"iron","root")
        q((-1.50,-1.88,1.80),(.61,.10,.53),"brass" if cinder else "statue_face")
        # Carved creature sign: salamander or badger, with separate eyes and muzzle.
        blob(m,(-1.50,-1.95,1.83),(.33,.08,.21),"iron")
        q((.7,-1.48,.40),(1.3,.43,.12),"wood")
        for x in (.25,1.15):q((x,-1.48,.25),(.15,.30,.30),"wood")
        for i in range(3):
            q((-1.4+i*.38,.99,.42),(.29,.43,.49),"iron" if cinder else "wood")
            if cinder:blob(m,(-1.4+i*.38,.99,.70),(.31,.39,.20),"iron")
    m.action("idle",60,{"root":[(1,(0,0,0)),(60,(0,0,0))]})
    return m
