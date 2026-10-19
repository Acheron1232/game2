import chunky as c
from _monsters import humanoid_monster


def plates(m, s):
    for side in ("L", "R"):
        c.shoulder_pad(m, side, slot=s.team, size=1.1, spikes=3, spike_slot=s.weapon_b)


def build():
    return humanoid_monster("ogre_warlord", "monsters_3_skin", "ogre_brute", height=2.7, build=1.7, hunch=0.9, weapon="club", extra=plates)
