"""Destroyable field lantern, sharing the novice's painted brass and amber glass panels."""
from mathutils import Matrix
from kit import Model
from _expansion_props import FoundryModel


class LanternModel(FoundryModel):
    def __init__(self):
        Model.__init__(self,"healing_lantern",skin="lantern_novice_skin")
        self.mapping_bone="root";self.local_inverse=Matrix.Identity(4)


def build():
    m=LanternModel();m.height=.9
    m.skeleton({"root":((0,0,0),(0,0,.2),None)})
    m.joints={"root":(0,0,0)}
    brass="lantern_novice__weapon_b";glass="lantern_novice__weapon_a"
    def box(at,size,glow=False):
        m.part("box",size,at=at,bone="root",slot=glass if glow else brass,
               sub=(.52,.98,.02,.98) if glow else (.02,.98,.52,.98),
               material="glow" if glow else "palette",light=not glow,bevel=.08)
    m.part("cylinder",(.66,.66,.10),at=(0,0,.05),slot=brass,sub=(.02,.98,.52,.98),bone="root",segments=10)
    box((0,0,.38),(.36,.36,.52),True)
    for x in (-.21,.21):
        for y in (-.21,.21):box((x,y,.38),(.06,.06,.58))
    for z in (.12,.66):box((0,0,z),(.51,.51,.10))
    m.part("cone",(.58,.58,.20),at=(0,0,.80),slot=brass,sub=(.02,.98,.52,.98),bone="root",segments=4)
    m.socket("light",(0,0,.45),"root")
    m.action("idle",60,{"root":[(1,(0,0,0)),(60,(0,0,0))]})
    return m
