<script setup lang="ts">
import ConfirmDialog from '@/components/admin/boards/ConfirmDialog.vue'
import CardHeading from '@/components/admin/CardHeading.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { useAdminAction } from '@/composables/use-admin-action'
import { authClient } from '@/lib/auth-client'
import { MEMBERSHIP_LIMIT } from '@/lib/limits'

interface Member {
  // The member row, which is what removing names
  id: string
  name: string
  email: string
  owner: boolean
  // The signed-in person themselves
  self: boolean
}

// `canManage`: the signed-in person owns the Kita. Owners remove admins;
// admins may leave on their own. The owner can do neither with themselves —
// a Kita always has its owner.
const props = defineProps<{
  organizationId: string
  organizationName: string
  members: Member[]
  canManage: boolean
}>()

const { pending, run } = useAdminAction()

async function remove(member: Member) {
  await run(
    () =>
      authClient.organization.removeMember({
        memberIdOrEmail: member.id,
        organizationId: props.organizationId,
      }),
    {
      leave: {
        reload: true,
        toast: `${member.name} verwaltet die Kita nicht mehr mit.`,
      },
    },
  )
}

// The middleware picks another Kita of theirs, if there is one
async function leave() {
  await run(
    () =>
      authClient.organization.leave({ organizationId: props.organizationId }),
    { leave: { href: '/admin' } },
  )
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Mitglieder</CardHeading>
      <CardDescription>
        Wer die Kita verwaltet ({{ props.members.length }} von höchstens
        {{ MEMBERSHIP_LIMIT }}).
        {{
          props.canManage
            ? 'Als Inhaberin oder Inhaber können Sie die Kita nicht verlassen.'
            : 'Einladen und entfernen kann nur die Inhaberin oder der Inhaber.'
        }}
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <ul class="divide-y rounded-md border text-sm">
        <li
          v-for="member in props.members"
          :key="member.id"
          class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 font-medium">
              <span class="truncate">{{ member.name }}</span>
              <Badge :variant="member.owner ? 'default' : 'secondary'">
                {{ member.owner ? 'Inhaber' : 'Admin' }}
              </Badge>
              <span v-if="member.self" class="font-normal text-muted-foreground"
                >(Sie)</span
              >
            </p>
            <p class="truncate text-muted-foreground">{{ member.email }}</p>
          </div>
          <ConfirmDialog
            v-if="props.canManage && !member.owner"
            :title="`${member.name} entfernen?`"
            :description="`${member.name} kann die Kita „${props.organizationName}“ danach nicht mehr verwalten. Das Konto bleibt bestehen.`"
            confirm-label="Entfernen"
            :pending="pending"
            @confirm="remove(member)"
          >
            <Button
              variant="outline"
              size="sm"
              class="aria-disabled:opacity-50"
              :aria-disabled="pending"
              :aria-label="`Entfernen: ${member.name} (${member.email})`"
            >
              Entfernen
            </Button>
          </ConfirmDialog>
        </li>
      </ul>
      <ConfirmDialog
        v-if="!props.canManage"
        :title="`Kita „${props.organizationName}“ verlassen?`"
        description="Sie können die Bretter dieser Kita danach nicht mehr verwalten. Zurück kommen Sie nur mit einer neuen Einladung."
        confirm-label="Kita verlassen"
        :pending="pending"
        @confirm="leave"
      >
        <Button
          variant="destructive"
          class="aria-disabled:opacity-50"
          :aria-disabled="pending"
        >
          Kita verlassen
        </Button>
      </ConfirmDialog>
    </CardContent>
  </Card>
</template>
