var mongoose = require('mongoose');
var User = require('../models/user');
var Task = require('../models/task');

module.exports = function (router) {

    router.get('/', function (req, res) {
        sendResponse(res, 200, 'APIed Piper API is running', { uptime: process.uptime() });
    });

    router.route('/users')
        .get(async function (req, res) {
            try {
                var where = parseJSONParam(req.query.where, 'where');
                var sort = parseJSONParam(req.query.sort, 'sort');
                var select = parseJSONParam(resolveSelectParam(req.query), resolveSelectName(req.query));
                var skip = parseIntegerParam(req.query.skip, 'skip');
                var limit = parseIntegerParam(req.query.limit, 'limit');
                var count = parseBooleanParam(req.query.count);

                var query = User.find(where || {});

                if (sort) {
                    query = query.sort(sort);
                }
                if (select) {
                    query = query.select(select);
                }
                if (typeof skip === 'number') {
                    query = query.skip(skip);
                }
                if (typeof limit === 'number' && !count) {
                    query = query.limit(limit);
                }

                if (count) {
                    var total = await User.countDocuments(where || {});
                    return sendResponse(res, 200, 'OK', total);
                }

                var users = await query.exec();
                return sendResponse(res, 200, 'OK', users);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to fetch users');
            }
        })
        .post(async function (req, res) {
            try {
                var body = req.body || {};
                var name = body.name ? String(body.name).trim() : '';
                var email = body.email ? String(body.email).trim() : '';

                if (!name || !email) {
                    throw createHttpError(400, 'Both name and email are required to create a user');
                }

                var pendingTasks = sanitizeIdArray(body.pendingTasks);
                var tasks = await ensureTasksExist(pendingTasks);

                var user = new User({
                    name: name,
                    email: email,
                    pendingTasks: pendingTasks
                });

                await user.save();

                await reconcilePendingTasks(user, pendingTasks, [], tasks);
                await Task.updateMany({ assignedUser: user._id.toString() }, { assignedUserName: user.name });

                return sendResponse(res, 201, 'User created', user);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to create user');
            }
        });

    router.route('/users/:id')
        .get(async function (req, res) {
            try {
                var id = req.params.id;
                if (!isValidObjectId(id)) {
                    throw createHttpError(400, 'Invalid user id');
                }

                var select = parseJSONParam(resolveSelectParam(req.query), resolveSelectName(req.query));
                var query = select ? User.findById(id).select(select) : User.findById(id);
                var user = await query.exec();

                if (!user) {
                    throw createHttpError(404, 'User not found');
                }

                return sendResponse(res, 200, 'OK', user);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to fetch user');
            }
        })
        .put(async function (req, res) {
            try {
                var id = req.params.id;
                if (!isValidObjectId(id)) {
                    throw createHttpError(400, 'Invalid user id');
                }

                var body = req.body || {};
                var name = body.name ? String(body.name).trim() : '';
                var email = body.email ? String(body.email).trim() : '';

                if (!name || !email) {
                    throw createHttpError(400, 'Both name and email are required to update a user');
                }

                var user = await User.findById(id);
                if (!user) {
                    throw createHttpError(404, 'User not found');
                }

                var newPending = sanitizeIdArray(body.pendingTasks);
                var tasks = await ensureTasksExist(newPending);

                var previousPending = user.pendingTasks.map(function (taskId) {
                    return String(taskId);
                });

                user.name = name;
                user.email = email;
                user.pendingTasks = newPending;
                await user.save();

                await reconcilePendingTasks(user, newPending, previousPending, tasks);
                await Task.updateMany({ assignedUser: user._id.toString() }, { assignedUserName: user.name });

                return sendResponse(res, 200, 'User updated', user);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to update user');
            }
        })
        .delete(async function (req, res) {
            try {
                var id = req.params.id;
                if (!isValidObjectId(id)) {
                    throw createHttpError(400, 'Invalid user id');
                }

                var user = await User.findById(id);
                if (!user) {
                    throw createHttpError(404, 'User not found');
                }

                await Task.updateMany({ assignedUser: id }, {
                    assignedUser: '',
                    assignedUserName: 'unassigned'
                });

                await User.deleteOne({ _id: id });

                return sendResponse(res, 200, 'User deleted', null);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to delete user');
            }
        });

    router.route('/tasks')
        .get(async function (req, res) {
            try {
                var where = parseJSONParam(req.query.where, 'where');
                var sort = parseJSONParam(req.query.sort, 'sort');
                var select = parseJSONParam(resolveSelectParam(req.query), resolveSelectName(req.query));
                var skip = parseIntegerParam(req.query.skip, 'skip');
                var limit = parseIntegerParam(req.query.limit, 'limit');
                var count = parseBooleanParam(req.query.count);

                if (typeof limit === 'undefined' && !count) {
                    limit = 100;
                }

                var query = Task.find(where || {});

                if (sort) {
                    query = query.sort(sort);
                }
                if (select) {
                    query = query.select(select);
                }
                if (typeof skip === 'number') {
                    query = query.skip(skip);
                }
                if (typeof limit === 'number' && !count) {
                    query = query.limit(limit);
                }

                if (count) {
                    var total = await Task.countDocuments(where || {});
                    return sendResponse(res, 200, 'OK', total);
                }

                var tasks = await query.exec();
                return sendResponse(res, 200, 'OK', tasks);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to fetch tasks');
            }
        })
        .post(async function (req, res) {
            try {
                var body = req.body || {};
                var name = body.name ? String(body.name).trim() : '';
                var deadline = parseDate(body.deadline);

                if (!name || !deadline) {
                    throw createHttpError(400, 'Both name and deadline are required to create a task');
                }

                var assignedUserId = normalizeAssignedUser(body.assignedUser);
                var assignedUser = null;

                if (assignedUserId) {
                    if (!isValidObjectId(assignedUserId)) {
                        throw createHttpError(400, 'Invalid assignedUser id');
                    }

                    assignedUser = await User.findById(assignedUserId);
                    if (!assignedUser) {
                        throw createHttpError(400, 'Assigned user not found');
                    }
                }

                var completed = parseBooleanParam(body.completed);
                var task = new Task({
                    name: name,
                    description: body.description || '',
                    deadline: deadline,
                    completed: completed,
                    assignedUser: assignedUserId,
                    assignedUserName: assignedUser ? assignedUser.name : 'unassigned'
                });

                await task.save();

                await updateUserPendingTasksAfterTaskChange(task, '', false);

                return sendResponse(res, 201, 'Task created', task);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to create task');
            }
        });

    router.route('/tasks/:id')
        .get(async function (req, res) {
            try {
                var id = req.params.id;
                if (!isValidObjectId(id)) {
                    throw createHttpError(400, 'Invalid task id');
                }

                var select = parseJSONParam(resolveSelectParam(req.query), resolveSelectName(req.query));
                var query = select ? Task.findById(id).select(select) : Task.findById(id);
                var task = await query.exec();

                if (!task) {
                    throw createHttpError(404, 'Task not found');
                }

                return sendResponse(res, 200, 'OK', task);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to fetch task');
            }
        })
        .put(async function (req, res) {
            try {
                var id = req.params.id;
                if (!isValidObjectId(id)) {
                    throw createHttpError(400, 'Invalid task id');
                }

                var task = await Task.findById(id);
                if (!task) {
                    throw createHttpError(404, 'Task not found');
                }

                var body = req.body || {};
                var name = body.name ? String(body.name).trim() : '';
                var deadline = parseDate(body.deadline);

                if (!name || !deadline) {
                    throw createHttpError(400, 'Both name and deadline are required to update a task');
                }

                var assignedUserId = normalizeAssignedUser(body.assignedUser);
                var assignedUser = null;

                if (assignedUserId) {
                    if (!isValidObjectId(assignedUserId)) {
                        throw createHttpError(400, 'Invalid assignedUser id');
                    }

                    assignedUser = await User.findById(assignedUserId);
                    if (!assignedUser) {
                        throw createHttpError(400, 'Assigned user not found');
                    }
                }

                var previousAssignedUser = task.assignedUser ? String(task.assignedUser) : '';
                var previousCompleted = !!task.completed;

                task.name = name;
                task.description = body.description || '';
                task.deadline = deadline;
                task.completed = parseBooleanParam(body.completed);
                task.assignedUser = assignedUserId;
                task.assignedUserName = assignedUser ? assignedUser.name : 'unassigned';

                await task.save();

                await updateUserPendingTasksAfterTaskChange(task, previousAssignedUser, previousCompleted);

                return sendResponse(res, 200, 'Task updated', task);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to update task');
            }
        })
        .delete(async function (req, res) {
            try {
                var id = req.params.id;
                if (!isValidObjectId(id)) {
                    throw createHttpError(400, 'Invalid task id');
                }

                var task = await Task.findById(id);
                if (!task) {
                    throw createHttpError(404, 'Task not found');
                }

                var assignedUserId = task.assignedUser ? String(task.assignedUser) : '';

                await Task.deleteOne({ _id: id });

                if (assignedUserId) {
                    await User.updateOne({ _id: assignedUserId }, { $pull: { pendingTasks: id } });
                }

                return sendResponse(res, 200, 'Task deleted', null);
            } catch (err) {
                return handleRouteError(res, err, 'Failed to delete task');
            }
        });

    return router;
};

function sendResponse(res, status, message, data) {
    return res.status(status).json({
        message: message,
        data: data === undefined ? null : data
    });
}

function handleRouteError(res, err, defaultMessage) {
    if (err && err.status) {
        return sendResponse(res, err.status, err.message, err.data || null);
    }

    if (err && (err.name === 'MongoError' || err.name === 'MongoServerError') && err.code === 11000) {
        var duplicateMessage = 'Duplicate value violates unique constraint';
        if (err.keyPattern && err.keyPattern.email) {
            duplicateMessage = 'Email already exists';
        }
        return sendResponse(res, 400, duplicateMessage, null);
    }

    if (err && err.name === 'ValidationError') {
        return sendResponse(res, 400, err.message, null);
    }

    console.error(err);
    return sendResponse(res, 500, defaultMessage || 'Server error', null);
}

function createHttpError(status, message, data) {
    var error = new Error(message);
    error.status = status;
    error.data = data === undefined ? null : data;
    return error;
}

function parseJSONParam(value, paramName) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch (err) {
        throw createHttpError(400, 'Invalid JSON for "' + paramName + '" parameter');
    }
}

function parseIntegerParam(value, paramName) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    var parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw createHttpError(400, '"' + paramName + '" must be a non-negative integer');
    }
    return parsed;
}

function parseBooleanParam(value) {
    if (value === undefined || value === null) {
        return false;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    var normalized = String(value).toLowerCase();
    if (normalized === 'true' || normalized === '1') {
        return true;
    }
    if (normalized === 'false' || normalized === '0') {
        return false;
    }

    return Boolean(value);
}

function parseDate(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    var parsedValue = value;

    if (typeof value === 'string') {
        var trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        var numeric = Number(trimmed);
        if (!Number.isNaN(numeric)) {
            parsedValue = numeric;
        } else {
            parsedValue = trimmed;
        }
    }

    var date = new Date(parsedValue);
    if (isNaN(date.getTime())) {
        return null;
    }
    return date;
}

function resolveSelectParam(query) {
    if (query.select !== undefined) {
        return query.select;
    }
    if (query.filter !== undefined) {
        return query.filter;
    }
    return undefined;
}

function resolveSelectName(query) {
    if (query.select !== undefined) {
        return 'select';
    }
    if (query.filter !== undefined) {
        return 'filter';
    }
    return 'select';
}

function sanitizeIdArray(values) {
    if (values === undefined || values === null) {
        return [];
    }

    var arrayValues;
    if (Array.isArray(values)) {
        arrayValues = values;
    } else if (typeof values === 'string') {
        var trimmed = values.trim();
        if (!trimmed) {
            return [];
        }
        if (trimmed.startsWith('[')) {
            try {
                var parsed = JSON.parse(trimmed);
                arrayValues = Array.isArray(parsed) ? parsed : [parsed];
            } catch (err) {
                throw createHttpError(400, 'Invalid task id list: ' + trimmed);
            }
        } else {
            arrayValues = [trimmed];
        }
    } else {
        arrayValues = [values];
    }

    var seen = new Set();
    var result = [];

    arrayValues.forEach(function (value) {
        if (value === undefined || value === null || value === '') {
            return;
        }

        if (Array.isArray(value)) {
            sanitizeIdArray(value).forEach(function (id) {
                if (!seen.has(id)) {
                    seen.add(id);
                    result.push(id);
                }
            });
            return;
        }

        var str = String(value).trim();
        if (!str) {
            return;
        }

        if (str.startsWith('[')) {
            try {
                var nestedParsed = JSON.parse(str);
                sanitizeIdArray(nestedParsed).forEach(function (id) {
                    if (!seen.has(id)) {
                        seen.add(id);
                        result.push(id);
                    }
                });
                return;
            } catch (err) {
                throw createHttpError(400, 'Invalid task id list: ' + str);
            }
        }

        if (!isValidObjectId(str)) {
            throw createHttpError(400, 'Invalid task id: ' + str);
        }

        if (!seen.has(str)) {
            seen.add(str);
            result.push(str);
        }
    });

    return result;
}

async function ensureTasksExist(taskIds) {
    if (!taskIds.length) {
        return [];
    }

    var tasks = await Task.find({ _id: { $in: taskIds } });
    var foundIds = tasks.map(function (task) { return task._id.toString(); });

    var missing = taskIds.filter(function (id) {
        return foundIds.indexOf(id) === -1;
    });

    if (missing.length) {
        throw createHttpError(400, 'Some tasks were not found', { missingTaskIds: missing });
    }

    return tasks;
}

async function reconcilePendingTasks(user, newPendingIds, previousPendingIds, preloadedTasks) {
    var userId = user._id.toString();
    var previousSet = new Set((previousPendingIds || []).map(String));
    var newSet = new Set((newPendingIds || []).map(String));

    var removedIds = [];
    previousSet.forEach(function (id) {
        if (!newSet.has(id)) {
            removedIds.push(id);
        }
    });

    if (removedIds.length) {
        var tasksToUnassign = await Task.find({
            _id: { $in: removedIds },
            assignedUser: userId
        });

        for (var i = 0; i < tasksToUnassign.length; i++) {
            tasksToUnassign[i].assignedUser = '';
            tasksToUnassign[i].assignedUserName = 'unassigned';
            await tasksToUnassign[i].save();
        }
    }

    var tasksMap = {};
    (preloadedTasks || []).forEach(function (task) {
        tasksMap[task._id.toString()] = task;
    });

    var idsToAssign = Array.from(newSet);
    if (idsToAssign.length) {
        var tasksToAssign = idsToAssign.map(function (id) {
            return tasksMap[id];
        }).filter(Boolean);

        if (tasksToAssign.length !== idsToAssign.length) {
            tasksToAssign = await Task.find({ _id: { $in: idsToAssign } });
        }

        for (var j = 0; j < tasksToAssign.length; j++) {
            var task = tasksToAssign[j];
            var currentAssigned = task.assignedUser ? String(task.assignedUser) : '';
            if (currentAssigned && currentAssigned !== userId) {
                await User.updateOne({ _id: currentAssigned }, { $pull: { pendingTasks: task._id.toString() } });
            }
            task.assignedUser = userId;
            task.assignedUserName = user.name;
            task.completed = false;
            await task.save();
        }
    }
}

async function updateUserPendingTasksAfterTaskChange(task, previousAssignedUserId, previousCompleted) {
    var taskId = task._id.toString();
    var newAssignedUserId = task.assignedUser ? String(task.assignedUser) : '';
    var hadPreviousUser = !!(previousAssignedUserId && String(previousAssignedUserId).trim());
    var hasNewUser = !!newAssignedUserId;

    if (hadPreviousUser && previousAssignedUserId !== newAssignedUserId) {
        await User.updateOne({ _id: previousAssignedUserId }, { $pull: { pendingTasks: taskId } });
    }

    if (hasNewUser) {
        if (task.completed) {
            await User.updateOne({ _id: newAssignedUserId }, { $pull: { pendingTasks: taskId } });
        } else {
            await User.updateOne({ _id: newAssignedUserId }, { $addToSet: { pendingTasks: taskId } });
        }
    } else {
        await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } });
    }

    if (hadPreviousUser && previousAssignedUserId === newAssignedUserId && previousCompleted !== task.completed) {
        if (task.completed) {
            await User.updateOne({ _id: newAssignedUserId }, { $pull: { pendingTasks: taskId } });
        } else {
            await User.updateOne({ _id: newAssignedUserId }, { $addToSet: { pendingTasks: taskId } });
        }
    }
}

function normalizeAssignedUser(value) {
    if (value === undefined || value === null) {
        return '';
    }

    var str = String(value).trim();
    if (!str || str.toLowerCase() === 'unassigned' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
        return '';
    }

    return str;
}

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}
